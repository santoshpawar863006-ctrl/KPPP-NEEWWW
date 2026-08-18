'use strict';

import baseWorker from './index.js';
import { requireAuthOrError } from './auth.js';

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

async function generalClaude(request, env) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }

  const question = String(body.question || body.prompt || '').trim();
  if (!question) {
    return json({ success: false, message: 'Type a question or instruction first.' }, 400);
  }
  if (question.length > 8000) {
    return json({ success: false, message: 'Message is too long. Keep it under 8000 characters.' }, 400);
  }

  const apiKey = String(env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY || '').trim();
  if (!apiKey) {
    return json({
      success: false,
      message: 'Claude API key is not configured in the Cloudflare Worker secrets.'
    }, 503);
  }

  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
  const messages = [];
  for (const turn of history) {
    const role = String(turn?.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user';
    const text = String(turn?.content || '').trim();
    if (!text) continue;
    messages.push({ role, content: text.slice(0, 8000) });
  }
  messages.push({ role: 'user', content: question });

  const system = `You are Claude, a capable general-purpose AI assistant embedded in the user's private workspace.
Help with the user's request across normal topics such as construction, tenders, business, coding, writing, calculations, documents, planning, learning, troubleshooting, brainstorming, and everyday questions.
Do not restrict answers to tenders or contracting unless the user asks about those topics.
Follow the user's language, tone, requested format, and level of detail when practical.
Be useful and action-oriented. When a task can be completed directly in text, complete it rather than only describing how.
Do not pretend you have tools, files, web browsing, account access, or real-time information unless that information is actually provided in the conversation.
If required information is missing, state the limitation clearly and give the best useful answer from the available context.`;

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
      const errText = await response.text();
      let detail = String(errText).slice(0, 260);
      try {
        const errJson = JSON.parse(errText);
        detail = String(errJson?.error?.message || errJson?.message || detail).slice(0, 260);
      } catch {}
      let message = `Claude HTTP ${response.status}. ${detail}`;
      if (response.status === 401) message = 'Claude rejected the API key. Check the Cloudflare ANTHROPIC_API_KEY / CLAUDE_API_KEY secret.';
      if (response.status === 429) message = `Claude rate limit or quota reached. ${detail}`;
      return json({ success: false, message }, response.status === 401 ? 401 : 502);
    }

    const payload = await response.json();
    const answer = Array.isArray(payload?.content)
      ? payload.content.map((part) => part?.text || '').join('\n').trim()
      : '';

    if (!answer) {
      return json({ success: false, message: 'Claude returned an empty answer. Try again.' }, 502);
    }

    return json({ success: true, answer, model: payload?.model || null, mode: 'general' });
  } catch (error) {
    return json({
      success: false,
      message: `Claude unavailable (${String(error).slice(0, 160)}).`
    }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Homepage chat sends only question/history and is intentionally general-purpose.
    // Tender Bid Calculator chat sends tender/bid_plan context and keeps the specialist handler.
    if (url.pathname === '/api/bid_ask' && request.method === 'POST') {
      const denied = await requireAuthOrError(request, env);
      if (denied) return denied;

      let body = {};
      try { body = await request.clone().json(); } catch { body = {}; }
      const hasTenderContext = Boolean(
        (body.tender && typeof body.tender === 'object' && Object.keys(body.tender).length) ||
        (body.bid_plan && typeof body.bid_plan === 'object' && Object.keys(body.bid_plan).length)
      );

      if (!hasTenderContext) return generalClaude(request, env);
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
