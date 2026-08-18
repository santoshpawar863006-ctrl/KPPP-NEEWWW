'use strict';

import baseWorker from './index.js';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

async function askClaude(request, env) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }

  const question = String(body.question || body.prompt || '').trim();
  if (!question) return json({ success: false, message: 'Type a question or instruction first.' }, 400);
  if (question.length > 8000) return json({ success: false, message: 'Keep the message under 8000 characters.' }, 400);

  const apiKey = String(env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY || env.AI_API_KEY || '').trim();
  if (!apiKey) return json({ success: false, message: 'Claude API key is not configured in Cloudflare secrets.' }, 503);

  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
  const messages = [];
  for (const turn of history) {
    const role = String(turn?.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user';
    const text = String(turn?.content || '').trim();
    if (text) messages.push({ role, content: text.slice(0, 8000) });
  }
  messages.push({ role: 'user', content: question });

  const system = `You are Claude, a capable general-purpose AI assistant in the user's private workspace. Help across normal topics including construction, tenders, business, coding, writing, calculations, documents, planning, troubleshooting, learning, brainstorming, and everyday questions. Do not restrict yourself to tenders unless the user asks about tenders. Follow the user's requested language, tone, format, and level of detail when practical. Be action-oriented and complete tasks directly when they can be done in text. Never claim access to tools, files, websites, accounts, or live data unless the user has actually provided that information.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || env.CLAUDE_MODEL || 'claude-sonnet-4-5',
        max_tokens: 2500,
        temperature: 0.4,
        system,
        messages
      })
    });

    if (!response.ok) {
      const raw = await response.text();
      let detail = raw.slice(0, 260);
      try {
        const parsed = JSON.parse(raw);
        detail = String(parsed?.error?.message || parsed?.message || detail).slice(0, 260);
      } catch {}
      return json({ success: false, message: `Claude request failed (${response.status}). ${detail}` }, 502);
    }

    const payload = await response.json();
    const answer = Array.isArray(payload?.content)
      ? payload.content.map((part) => part?.text || '').join('\n').trim()
      : '';
    if (!answer) return json({ success: false, message: 'Claude returned an empty answer.' }, 502);

    return json({ success: true, answer, model: payload?.model || null });
  } catch (error) {
    return json({ success: false, message: `Claude unavailable (${String(error).slice(0, 160)}).` }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': '*' } });
    }
    if (url.pathname === '/api/claude' && request.method === 'POST') return askClaude(request, env);
    return baseWorker.fetch(request, env, ctx);
  }
};
