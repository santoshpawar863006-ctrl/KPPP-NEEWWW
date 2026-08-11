'use strict';

(() => {
  const CACHE_KEY = 'kppp_secondary_emd_cache_v1';
  const FAIL_TTL = 6 * 60 * 60 * 1000;
  const SUCCESS_TTL = 24 * 60 * 60 * 1000;
  const MAX_CONCURRENT = 2;
  let active = 0;
  const queue = [];

  function loadCache(){
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveCache(cache){
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
    catch {}
  }

  const cache = loadCache();

  function isZeroText(value){
    const text = String(value || '').replace(/\s+/g,' ').trim();
    return /^₹?\s*0(?:\.0+)?$/i.test(text);
  }

  function cleanRef(value){
    return String(value || '').trim();
  }

  function cachedResult(ref){
    const item = cache[ref];
    if(!item) return null;
    const ttl = item.success ? SUCCESS_TTL : FAIL_TTL;
    if(Date.now() - item.saved_at > ttl){
      delete cache[ref];
      saveCache(cache);
      return null;
    }
    return item;
  }

  function remember(ref, payload){
    cache[ref] = {
      success: Boolean(payload && payload.success && Number(payload.emd) > 0),
      emd: payload && Number(payload.emd) > 0 ? Number(payload.emd) : null,
      source: payload && payload.source ? String(payload.source) : null,
      url: payload && payload.url ? String(payload.url) : null,
      tender_fee: payload && Number(payload.tender_fee) > 0 ? Number(payload.tender_fee) : null,
      saved_at: Date.now()
    };
    saveCache(cache);
    return cache[ref];
  }

  function formatMoney(value){
    return '₹' + Number(value).toLocaleString('en-IN',{maximumFractionDigits:2});
  }

  function setAmountUnavailable(cell){
    if(!cell) return;
    const txt = cell.textContent.trim();
    if(isZeroText(txt)){
      cell.innerHTML = '<span class="zero-unavailable">Not available</span><span class="mini-source primary">KPPP</span>';
    }
  }

  function renderSecondaryEmd(cell, result){
    if(!cell || !result || !result.emd) return;
    const link = result.url ? ` href="${String(result.url).replace(/"/g,'%22')}" target="_blank" rel="noopener noreferrer"` : '';
    cell.innerHTML = `<strong>${formatMoney(result.emd)}</strong><br><a class="secondary-emd-source"${link}>🟠 Secondary · ${escapeHtml(result.source || 'External')}</a>`;
  }

  function renderNoEmd(cell){
    if(!cell) return;
    cell.innerHTML = '<span class="zero-unavailable">Not available</span><span class="mini-source primary">KPPP</span>';
  }

  function renderChecking(cell){
    if(!cell) return;
    cell.innerHTML = '<span class="emd-checking">Checking secondary…</span>';
  }

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  async function doLookup(task){
    const {ref,cell} = task;
    try{
      const response = await fetch('/api/secondary_emd?tender=' + encodeURIComponent(ref), {cache:'no-store'});
      const payload = response.ok ? await response.json() : {success:false};
      const result = remember(ref,payload);
      if(result.success) renderSecondaryEmd(cell,result);
      else renderNoEmd(cell);
    }catch{
      const result = remember(ref,{success:false});
      if(!result.success) renderNoEmd(cell);
    }finally{
      active--;
      pump();
    }
  }

  function pump(){
    while(active < MAX_CONCURRENT && queue.length){
      const task = queue.shift();
      if(!task || !document.body.contains(task.cell)) continue;
      active++;
      doLookup(task);
    }
  }

  function enqueue(ref,cell){
    if(!ref || !cell || cell.dataset.emdQueued === '1') return;
    cell.dataset.emdQueued = '1';

    const existing = cachedResult(ref);
    if(existing){
      if(existing.success) renderSecondaryEmd(cell,existing);
      else renderNoEmd(cell);
      return;
    }

    renderChecking(cell);
    queue.push({ref,cell});
    pump();
  }

  function processRows(){
    const tbody = document.getElementById('tableBody');
    if(!tbody) return;

    for(const row of tbody.querySelectorAll('tr')){
      const cells = row.querySelectorAll('td');
      if(cells.length < 6) continue;

      const amountCell = cells[4];
      const emdCell = cells[5];
      const ref = cleanRef(row.querySelector('.t-title + .muted')?.textContent || row.querySelector('.muted')?.textContent || '');

      setAmountUnavailable(amountCell);

      const emdText = emdCell.textContent.trim();
      if(emdText === '—' || emdText === '-' || emdText === '' || isZeroText(emdText)){
        enqueue(ref,emdCell);
      }
    }
  }

  function processModal(){
    const modal = document.getElementById('modalBody');
    if(!modal) return;
    modal.querySelectorAll('.metric').forEach(metric => {
      const label = metric.querySelector('span')?.textContent.trim().toUpperCase() || '';
      const strong = metric.querySelector('strong');
      if(strong && (label.includes('ESTIMATED') || label === 'EMD' || label.includes('TENDER FEE')) && isZeroText(strong.textContent)){
        strong.textContent = 'Not available';
      }
    });
  }

  let scheduled = false;
  function schedule(){
    if(scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      processRows();
      processModal();
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement,{subtree:true,childList:true});
  window.addEventListener('load',schedule);
  schedule();
})();