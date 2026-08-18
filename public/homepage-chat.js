'use strict';

(() => {
  const STORAGE_KEY = 'kppp_home_claude_chat_v1';
  const MAX_TURNS = 20;
  let turns = loadTurns();
  let busy = false;

  const byId = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[c]));

  function loadTurns() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed)
        ? parsed.filter((x) => x && ['user', 'assistant'].includes(x.role) && String(x.content || '').trim()).slice(-MAX_TURNS)
        : [];
    } catch {
      return [];
    }
  }

  function saveTurns() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-MAX_TURNS))); } catch {}
  }

  function renderThread() {
    const thread = byId('homeAiThread');
    if (!thread) return;
    if (!turns.length) {
      thread.innerHTML = `
        <div class="hc-turn assistant hc-welcome">
          <div class="hc-avatar">AI</div>
          <div class="hc-bubble">
            <strong>Claude Tender Assistant</strong>
            <p>Ask me about KPPP tenders, eligibility, EMD, documents, bid discounts, profit, site risks, or what you should verify before bidding.</p>
          </div>
        </div>`;
      return;
    }
    thread.innerHTML = turns.map((turn) => `
      <div class="hc-turn ${turn.role}">
        <div class="hc-avatar">${turn.role === 'assistant' ? 'AI' : 'You'}</div>
        <div class="hc-bubble">
          <strong>${turn.role === 'assistant' ? 'Claude' : 'You'}</strong>
          <p>${esc(turn.content).replace(/\n/g, '<br>')}</p>
        </div>
      </div>`).join('');
    thread.scrollTop = thread.scrollHeight;
  }

  function setStatus(text, kind = '') {
    const status = byId('homeAiStatus');
    if (!status) return;
    status.textContent = text || '';
    status.className = `hc-status${kind ? ` ${kind}` : ''}`;
  }

  function setBusy(next) {
    busy = next;
    const send = byId('homeAiSend');
    const input = byId('homeAiInput');
    const clear = byId('homeAiClear');
    if (send) {
      send.disabled = next;
      send.textContent = next ? 'Asking Claude…' : 'Ask Claude';
    }
    if (input) input.disabled = next;
    if (clear) clear.disabled = next;
  }

  async function sendQuestion(prefill = '') {
    if (busy) return;
    const input = byId('homeAiInput');
    const question = String(prefill || input?.value || '').trim();
    if (!question) {
      setStatus('Type your question first.', 'warn');
      input?.focus();
      return;
    }
    if (question.length > 2000) {
      setStatus('Keep the question under 2000 characters.', 'warn');
      return;
    }

    const history = turns.slice(-6).map(({ role, content }) => ({ role, content }));
    turns.push({ role: 'user', content: question });
    if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
    saveTurns();
    renderThread();
    if (input) input.value = '';
    setBusy(true);
    setStatus('Claude is thinking…', 'loading');

    try {
      const response = await fetch('/api/bid_ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({ success: false, message: 'Invalid AI response.' }));
      if (!response.ok || !payload.success) {
        const message = response.status === 401
          ? 'Your login session has expired. Please sign in again to use Claude.'
          : (payload.message || `Claude request failed (HTTP ${response.status}).`);
        throw new Error(message);
      }
      const answer = String(payload.answer || '').trim();
      if (!answer) throw new Error('Claude returned an empty answer. Please try again.');
      turns.push({ role: 'assistant', content: answer });
      if (turns.length > MAX_TURNS) turns = turns.slice(-MAX_TURNS);
      saveTurns();
      renderThread();
      setStatus('Answer ready.', 'ok');
    } catch (error) {
      setStatus(String(error?.message || error || 'Claude is unavailable right now.').slice(0, 240), 'warn');
    } finally {
      setBusy(false);
      input?.focus();
    }
  }

  function clearChat() {
    turns = [];
    saveTurns();
    renderThread();
    setStatus('Chat cleared.');
    byId('homeAiInput')?.focus();
  }

  function bind() {
    const form = byId('homeAiForm');
    const input = byId('homeAiInput');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      sendQuestion();
    });
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendQuestion();
      }
    });
    byId('homeAiClear')?.addEventListener('click', clearChat);
    document.querySelectorAll('[data-home-ai-question]').forEach((button) => {
      button.addEventListener('click', () => sendQuestion(button.dataset.homeAiQuestion || button.textContent || ''));
    });
    renderThread();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
