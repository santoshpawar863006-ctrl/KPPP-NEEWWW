'use strict';

(() => {
  const CACHE_KEY = 'kppp_missing_financial_tenderkart_v1';
  const SUCCESS_TTL = 24 * 60 * 60 * 1000;
  const MISS_TTL = 6 * 60 * 60 * 1000;
  const MAX_CONCURRENT = 3;
  let active = 0;
  const queue = [];

  function loadCache(){
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveCache(){
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
  }
  const cache = loadCache();

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }
  function numeric(value){
    const n = Number(String(value ?? '').replace(/[₹,]/g, '').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function money(value){
    return '₹' + Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  function missing(value){
    const t = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t || ['—','-','n/a','na','not available','refer tender','refer document','refer documents'].includes(t)) return true;
    return /^₹?\s*0(?:\.0+)?$/.test(t);
  }
  function rowRef(row){
    return String(row.querySelector('.t-title + .muted')?.textContent || '').trim();
  }
  function cached(ref){
    const item = cache[ref];
    if (!item) return null;
    const ttl = item.found ? SUCCESS_TTL : MISS_TTL;
    if (Date.now() - Number(item.saved_at || 0) > ttl) {
      delete cache[ref]; saveCache(); return null;
    }
    return item;
  }
  function remember(ref, result){
    cache[ref] = { ...result, saved_at: Date.now() };
    saveCache();
    return cache[ref];
  }

  function applyField(cell, value, sourceUrl){
    if (!cell || !numeric(value)) return;
    const link = sourceUrl
      ? `<a class="secondary-fin-source" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">TenderKart verified ↗</a>`
      : '<span class="secondary-fin-source">TenderKart verified</span>';
    cell.innerHTML = `<strong>${money(value)}</strong><br>${link}`;
    cell.dataset.secondaryFinancial = 'tenderkart';
  }

  function applyResult(task, result){
    if (!task?.row?.isConnected || !result?.found) return;
    if (task.needAmount && missing(task.amountCell?.textContent)) applyField(task.amountCell, result.amount, result.url);
    if (task.needEmd && missing(task.emdCell?.textContent)) applyField(task.emdCell, result.emd, result.url);
  }

  async function lookup(task){
    try {
      const params = new URLSearchParams({ tender: task.ref, source: 'tenderkart' });
      const response = await fetch('/api/public_tender_detail?' + params.toString(), { cache: 'no-store' });
      const payload = response.ok ? await response.json() : null;
      const source = Array.isArray(payload?.sources) ? payload.sources.find(x => String(x?.source || '').toLowerCase() === 'tenderkart') : null;
      const signals = source?.signals || {};
      const result = remember(task.ref, {
        found: Boolean(source && (numeric(signals.tender_value) || numeric(signals.emd))),
        amount: numeric(signals.tender_value),
        emd: numeric(signals.emd),
        tender_fee: numeric(signals.tender_fee),
        url: source?.url || null,
        match_method: source?.match_method || null
      });
      applyResult(task, result);
    } catch {
      remember(task.ref, { found: false, amount: null, emd: null, tender_fee: null, url: null });
    } finally {
      active--;
      pump();
    }
  }

  function pump(){
    while (active < MAX_CONCURRENT && queue.length) {
      const task = queue.shift();
      if (!task?.row?.isConnected) continue;
      active++;
      lookup(task);
    }
  }

  function processRows(){
    const body = document.getElementById('tableBody');
    if (!body) return;
    for (const row of body.querySelectorAll('tr')) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 6 || row.dataset.missingFinancialChecked === '1') continue;
      const ref = rowRef(row);
      if (!ref) continue;
      const amountCell = cells[4];
      const emdCell = cells[5];
      const needAmount = missing(amountCell.textContent);
      const needEmd = missing(emdCell.textContent);
      row.dataset.missingFinancialChecked = '1';
      if (!needAmount && !needEmd) continue;

      const task = { ref, row, amountCell, emdCell, needAmount, needEmd };
      const hit = cached(ref);
      if (hit) {
        applyResult(task, hit);
        continue;
      }
      queue.push(task);
    }
    pump();
  }

  let timer = null;
  function schedule(){
    clearTimeout(timer);
    timer = setTimeout(processRows, 80);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', schedule);
  document.addEventListener('change', schedule);
  schedule();
})();
