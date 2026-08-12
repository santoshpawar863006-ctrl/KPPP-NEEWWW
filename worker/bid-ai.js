'use strict';

const MODEL = '@cf/zai-org/glm-4.7-flash';

function json(payload, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function compactPayload(body) {
  const tender = body?.tender || {};
  const assumptions = body?.assumptions || {};
  const calculations = body?.calculations || {};
  const tk = body?.tenderkart || null;
  return {
    tender: {
      ref: String(tender.ref || '').slice(0, 180),
      title: String(tender.title || '').slice(0, 500),
      category: String(tender.category || '').slice(0, 30),
      department: String(tender.department || '').slice(0, 250),
      city: String(tender.city || '').slice(0, 120),
      location: String(tender.location || '').slice(0, 250),
      amount: safeNumber(tender.amount),
      emd: safeNumber(tender.emd),
      closing_date: String(tender.closing_date || '').slice(0, 80)
    },
    assumptions: {
      direct_cost_pct: safeNumber(assumptions.direct_cost_pct),
      overhead_pct: safeNumber(assumptions.overhead_pct),
      contingency_pct: safeNumber(assumptions.contingency_pct),
      local_saving_pct: safeNumber(assumptions.local_saving_pct),
      target_profit_margin_pct: safeNumber(assumptions.target_profit_margin_pct)
    },
    calculations: {
      ecv: safeNumber(calculations.ecv),
      estimated_site_cost: safeNumber(calculations.estimated_site_cost),
      break_even_bid: safeNumber(calculations.break_even_bid),
      indicative_target_bid: safeNumber(calculations.indicative_target_bid),
      expected_profit: safeNumber(calculations.expected_profit),
      target_discount_vs_ecv_pct: safeNumber(calculations.target_discount_vs_ecv_pct),
      max_break_even_discount_pct: safeNumber(calculations.max_break_even_discount_pct)
    },
    tenderkart: tk ? {
      tender_class: String(tk.tender_class || '').slice(0, 100),
      reservation: String(tk.reservation || '').slice(0, 100),
      kpwd_class: String(tk.kpwd_class || '').slice(0, 100),
      bid_value_type: String(tk.bid_value_type || '').slice(0, 100),
      tax_type: String(tk.tax_type || '').slice(0, 120),
      bid_validity_days: safeNumber(tk.bid_validity_days),
      eligibility: Array.isArray(tk.eligibility) ? tk.eligibility.slice(0, 8).map(x => String(x).slice(0, 500)) : [],
      technical_criteria: Array.isArray(tk.technical_criteria) ? tk.technical_criteria.slice(0, 8).map(x => String(x).slice(0, 500)) : [],
      documents_required: Array.isArray(tk.documents_required) ? tk.documents_required.slice(0, 8).map(x => String(x).slice(0, 300)) : [],
      boq_preview: Array.isArray(tk.boq_preview) ? tk.boq_preview.slice(0, 8).map(x => String(x).slice(0, 500)) : []
    } : null
  };
}

function cacheKeyFor(payload) {
  const ref = encodeURIComponent(payload.tender.ref || 'unknown').slice(0, 220);
  const a = payload.assumptions;
  const c = payload.calculations;
  const signature = [a.direct_cost_pct,a.overhead_pct,a.contingency_pct,a.local_saving_pct,a.target_profit_margin_pct,c.ecv].map(v => v ?? '').join('-');
  return new Request(`https://bid-ai-cache.invalid/review?ref=${ref}&s=${encodeURIComponent(signature)}`);
}

function extractText(result) {
  if (typeof result === 'string') return result.trim();
  if (!result || typeof result !== 'object') return '';
  if (typeof result.response === 'string') return result.response.trim();
  if (typeof result.result?.response === 'string') return result.result.response.trim();
  const choices = Array.isArray(result.choices) ? result.choices : [];
  const content = choices[0]?.message?.content ?? choices[0]?.text;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map(x => typeof x === 'string' ? x : (x?.text || '')).join('\n').trim();
  return '';
}

export async function handleBidAi(request, env, ctx) {
  if (!env?.AI || typeof env.AI.run !== 'function') {
    return json({ success: false, message: 'Cloudflare Workers AI is not enabled for this Worker yet.' }, 503);
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 30000) return json({ success: false, message: 'AI request is too large.' }, 413);

  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, message: 'Invalid JSON request.' }, 400); }

  const payload = compactPayload(body);
  if (!payload.tender.ref || !payload.calculations.ecv || !payload.calculations.estimated_site_cost) {
    return json({ success: false, message: 'Tender reference, ECV and calculated site cost are required.' }, 400);
  }

  const cache = caches.default;
  const cacheKey = cacheKeyFor(payload);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const system = `You are a conservative Karnataka public-tender bid review assistant for a contractor. Use only the supplied tender data and calculator assumptions. Do not invent local material rates, labour rates, BOQ quantities, competitor bids, winning probabilities, undisclosed KPPP facts, or eligibility. Never recommend collusion or coordination with other bidders. The deterministic calculator is authoritative for arithmetic. Your job is to identify cost drivers, missing information, commercial risks, and whether the target bid is internally consistent with the stated assumptions. If the BOQ/rate information is insufficient, explicitly say that the actual on-site cost cannot be established from the available data. Keep the answer practical and concise. Use these headings: Cost View, Bid View, Risks / Missing Checks, Before You Submit.`;
  const user = `Review this tender planning data:\n${JSON.stringify(payload)}`;

  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2,
      max_completion_tokens: 550
    });
    const review = extractText(result);
    if (!review) return json({ success: false, message: 'AI returned no readable review.' }, 502);

    const response = json({
      success: true,
      model: MODEL,
      review,
      note: 'Planning assistance only. Final bid should be based on verified BOQ quantities, current supplier/labour/equipment rates, taxes, contract conditions and site inspection.'
    }, 200, 'public, max-age=21600, s-maxage=21600');
    ctx?.waitUntil?.(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    const text = String(error?.message || error || '').slice(0, 300);
    const quota = /quota|limit|neuron|usage|exceed/i.test(text);
    return json({
      success: false,
      message: quota ? 'The free AI allowance is temporarily exhausted. The Bid & Site Cost calculator still works without AI.' : 'AI review is temporarily unavailable. The Bid & Site Cost calculator still works without AI.'
    }, quota ? 429 : 502);
  }
}
