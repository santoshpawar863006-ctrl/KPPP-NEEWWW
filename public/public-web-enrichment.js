'use strict';

(() => {
  const e = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  function money(value){
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? '₹' + n.toLocaleString('en-IN', {maximumFractionDigits:2}) : '—';
  }

  function currentTender(){
    try{
      const sub = document.getElementById('modalSub')?.textContent || '';
      const parts = sub.split('•').map(x => x.trim()).filter(Boolean);
      const ref = parts.length >= 2 ? parts[1] : '';
      if(!ref || typeof state === 'undefined' || !Array.isArray(state.all)) return null;
      return state.all.find(t => String(t.ref_no || t.id || '').trim() === ref) || null;
    }catch{
      return null;
    }
  }

  function installButton(){
    if(document.getElementById('publicWebDetailBtn')) return;
    const close = document.getElementById('modalClose');
    if(!close) return;

    const btn = document.createElement('button');
    btn.id = 'publicWebDetailBtn';
    btn.type = 'button';
    btn.className = 'public-web-btn';
    btn.textContent = '＋ More Public Data';
    btn.title = 'Search public web sources for additional details about this tender';
    close.parentElement?.insertBefore(btn, close);
    btn.addEventListener('click', loadPublicData);
  }

  function signalRows(signals){
    const rows = [];
    if(signals?.reservation) rows.push(['Reservation', signals.reservation]);
    if(signals?.kpwd_class) rows.push(['KPWD Class', signals.kpwd_class]);
    if(signals?.minimum_tender_capacity) rows.push(['Minimum Tender Capacity', money(signals.minimum_tender_capacity)]);
    if(signals?.minimum_financial_turnover) rows.push(['Minimum Financial Turnover', money(signals.minimum_financial_turnover)]);
    if(signals?.bid_validity_days) rows.push(['Bid Validity', `${signals.bid_validity_days} days`]);
    return rows;
  }

  function renderResult(payload, tender){
    const body = document.getElementById('modalBody');
    if(!body) return;
    body.querySelector('.public-web-section')?.remove();

    const sources = Array.isArray(payload?.sources) ? payload.sources : [];
    if(!sources.length){
      body.insertAdjacentHTML('beforeend', `
        <section class="detail-section public-web-section">
          <div class="section-title"><h3>More Public Data</h3><span class="count-chip">Web search</span></div>
          <div class="empty-block">No verified public web page was found for ${e(tender?.ref_no || tender?.id || 'this tender')} right now. KPPP tender data above remains unchanged.</div>
        </section>`);
      return;
    }

    body.insertAdjacentHTML('beforeend', `
      <section class="detail-section public-web-section">
        <div class="section-title"><h3>More Public Data</h3><span class="count-chip">${sources.length} verified source${sources.length===1?'':'s'}</span></div>
        <div class="public-web-note">KPPP remains the main source. These pages are used only to fill missing context. Verify the linked source before relying on an eligibility or financial condition.</div>
        <div class="public-source-list">
          ${sources.map(source => {
            const rows = signalRows(source.signals || {});
            const tags = Array.isArray(source?.signals?.tags) ? source.signals.tags : [];
            const safeUrl = String(source.url || '').startsWith('http') ? source.url : '#';
            return `<article class="public-source-card">
              <div class="public-source-head">
                <div><strong>${e(source.title || source.host || 'Public tender source')}</strong><small>${source.official ? 'Official government source' : 'Public indexed document mirror'} • ${e(source.host || '')}</small></div>
                <a href="${e(safeUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>
              </div>
              ${rows.length ? `<div class="public-signal-grid">${rows.map(([k,v])=>`<div><span>${e(k)}</span><strong>${e(v)}</strong></div>`).join('')}</div>` : ''}
              ${tags.length ? `<div class="public-tag-row">${tags.map(tag=>`<span>${e(tag)}</span>`).join('')}</div>` : '<div class="public-no-signals">Verified tender reference found; no additional structured field could be extracted automatically.</div>'}
            </article>`;
          }).join('')}
        </div>
      </section>`);

    body.querySelector('.public-web-section')?.scrollIntoView({behavior:'smooth', block:'start'});
  }

  async function loadPublicData(){
    const btn = document.getElementById('publicWebDetailBtn');
    const tender = currentTender();
    if(!btn || !tender) return;

    const tenderRef = String(tender.ref_no || tender.id || '').trim();
    if(!tenderRef) return;

    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = 'Searching public sources…';

    try{
      const r = await fetch('/api/public_tender_detail?tender=' + encodeURIComponent(tenderRef), {cache:'no-store'});
      if(!r.ok) throw new Error('Public detail search failed');
      const payload = await r.json();
      if(!payload?.success) throw new Error(payload?.message || 'Public detail search failed');
      renderResult(payload, tender);
    }catch{
      const body = document.getElementById('modalBody');
      body?.querySelector('.public-web-section')?.remove();
      body?.insertAdjacentHTML('beforeend', `
        <section class="detail-section public-web-section">
          <div class="section-title"><h3>More Public Data</h3></div>
          <div class="empty-block">Public web enrichment is temporarily unavailable. The KPPP tender information above is unaffected.</div>
        </section>`);
    }finally{
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installButton);
  else installButton();
})();
