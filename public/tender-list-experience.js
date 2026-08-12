'use strict';

(() => {
  function decode(value){
    try { return decodeURIComponent(value || ''); }
    catch { return String(value || ''); }
  }

  function processTable(){
    const table = document.querySelector('.tender-table');
    const body = document.getElementById('tableBody');
    if (!table || !body) return;

    const headers = [...table.querySelectorAll('thead th')];
    const actionIndex = headers.findIndex(th => String(th.textContent || '').trim().toLowerCase() === 'action');
    if (actionIndex >= 0) headers[actionIndex].classList.add('list-action-hidden');

    body.querySelectorAll('tr').forEach(row => {
      const detail = row.querySelector('[data-detail]');
      if (!detail) return;
      const key = decode(detail.dataset.detail);
      if (!key) return;
      row.dataset.openTenderKey = encodeURIComponent(key);
      row.classList.add('clickable-tender-row');
      row.title = 'Click anywhere on this tender to open details';
      const cells = row.querySelectorAll('td');
      if (actionIndex >= 0 && cells[actionIndex]) cells[actionIndex].classList.add('list-action-hidden');
    });
  }

  function compareButtonFor(key){
    return [...document.querySelectorAll('[data-compare-key]')]
      .find(btn => decode(btn.dataset.compareKey) === key) || null;
  }

  function updateDetailCompareState(key){
    const toggle = document.getElementById('detailCompareToggle');
    const open = document.getElementById('detailOpenCompare');
    if (!toggle || !open) return;
    const hiddenButton = compareButtonFor(key);
    const selected = Boolean(hiddenButton?.classList.contains('selected'));
    toggle.textContent = selected ? '✓ Added to Compare' : '＋ Add to Compare';
    toggle.classList.toggle('selected', selected);
    const count = Number(document.getElementById('compareCount')?.textContent || 0);
    open.hidden = count < 1;
  }

  function ensureDetailActions(key){
    const head = document.querySelector('#detailModal .modal-head');
    const titleBlock = head?.querySelector(':scope > div:first-child');
    if (!head || !titleBlock || !key) return;

    let bar = document.getElementById('detailQuickActions');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'detailQuickActions';
      bar.className = 'detail-quick-actions';
      bar.innerHTML = `
        <button type="button" id="detailCompareToggle">＋ Add to Compare</button>
        <button type="button" id="detailOpenCompare" class="secondary" hidden>⇄ Open Comparison</button>`;
      titleBlock.appendChild(bar);

      document.getElementById('detailCompareToggle')?.addEventListener('click', () => {
        const current = bar.dataset.tenderKey || '';
        let hiddenButton = compareButtonFor(current);
        if (!hiddenButton) {
          processTable();
          hiddenButton = compareButtonFor(current);
        }
        if (hiddenButton) hiddenButton.click();
        setTimeout(() => updateDetailCompareState(current), 0);
      });
      document.getElementById('detailOpenCompare')?.addEventListener('click', () => {
        document.getElementById('compareSelectedBtn')?.click();
      });
    }
    bar.dataset.tenderKey = key;
    setTimeout(() => updateDetailCompareState(key), 0);
    setTimeout(() => updateDetailCompareState(key), 180);
  }

  function stabilizePlanner(){
    const panel = document.getElementById('analyticsPanel');
    const planner = document.getElementById('bidCostPlanner');
    if (!panel || !planner) return;
    if (planner.parentElement === panel) panel.insertAdjacentElement('afterend', planner);
    if (planner.hidden !== panel.hidden) planner.hidden = panel.hidden;
  }

  function wrapDetails(){
    if (window.__kpppClickableDetailWrapped || typeof window.openDetails !== 'function') return false;
    const base = window.openDetails;
    window.openDetails = async function(key){
      ensureDetailActions(String(key || ''));
      const result = await base(key);
      ensureDetailActions(String(key || ''));
      return result;
    };
    window.__kpppClickableDetailWrapped = true;
    return true;
  }

  document.getElementById('tableBody')?.addEventListener('click', event => {
    if (event.target.closest('button,a,input,select,textarea,label')) return;
    const row = event.target.closest('tr[data-open-tender-key]');
    if (!row) return;
    const key = decode(row.dataset.openTenderKey);
    if (key && typeof window.openDetails === 'function') window.openDetails(key);
  });

  document.getElementById('tableBody')?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('button,a,input,select,textarea')) return;
    const row = event.target.closest('tr[data-open-tender-key]');
    if (!row) return;
    event.preventDefault();
    const key = decode(row.dataset.openTenderKey);
    if (key && typeof window.openDetails === 'function') window.openDetails(key);
  });

  const observer = new MutationObserver(() => {
    processTable();
    stabilizePlanner();
    wrapDetails();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    processTable();
    stabilizePlanner();
    wrapDetails();
    if (attempts > 120) clearInterval(timer);
  }, 100);

  document.addEventListener('click', event => {
    if (event.target?.id === 'analyticsToggle') {
      setTimeout(stabilizePlanner, 80);
      setTimeout(stabilizePlanner, 180);
    }
  });

  processTable();
  wrapDetails();
})();
