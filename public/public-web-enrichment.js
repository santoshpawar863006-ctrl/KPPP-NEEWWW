'use strict';

(() => {
  const e = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const money = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? '₹' + n.toLocaleString('en-IN', {maximumFractionDigits:2}) : '—';
  };
  const dateText = (value) => {
    if(!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('en-IN', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  };

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
    btn.textContent = '＋ Search TenderKart / BidAssist / TendersPlus';
    btn.title = 'Search public tender intelligence pages for additional tender details';
    close.parentElement?.insertBefore(btn, close);
    btn.addEventListener('click', loadPublicData);
  }

  function signalRows(signals){
    const rows = [];
    if(signals?.tender_value) rows.push(['Tender Value', money(signals.tender_value)]);
    if(signals?.emd) rows.push(['EMD', money(signals.emd)]);
    if(signals?.tender_fee) rows.push(['Tender Fee', money(signals.tender_fee)]);
    if(signals?.tender_class) rows.push(['Tender Class', signals.tender_class]);
    if(signals?.reservation) rows.push(['Reservation', signals.reservation]);
    if(signals?.kpwd_class) rows.push(['KPWD / PWD Class', signals.kpwd_class]);
    if(signals?.form_of_contract) rows.push(['Form of Contract', signals.form_of_contract]);
    if(signals?.tender_category) rows.push(['Tender Category', signals.tender_category]);
    if(signals?.product_category) rows.push(['Product Category', signals.product_category]);
    if(signals?.bid_value_type) rows.push(['Bid Value Type', signals.bid_value_type]);
    if(signals?.denomination_type) rows.push(['Denomination', signals.denomination_type]);
    if(signals?.tax_type) rows.push(['Tax Type', signals.tax_type]);
    if(signals?.nit_id) rows.push(['NIT ID', signals.nit_id]);
    if(signals?.bid_validity_days) rows.push(['Bid Validity', `${signals.bid_validity_days} days`]);
    if(signals?.published_date) rows.push(['Published', dateText(signals.published_date)]);
    if(signals?.closing_date) rows.push(['Bid Submission End', dateText(signals.closing_date)]);
    if(signals?.bid_opening_date) rows.push(['Bid Opening', dateText(signals.bid_opening_date)]);
    if(signals?.download_end_date) rows.push(['Document Download Ends', dateText(signals.download_end_date)]);
    if(signals?.location) rows.push(['Location', signals.location]);
    if(signals?.contact_person) rows.push(['Contact Person', signals.contact_person]);
    if(signals?.mobile_number) rows.push(['Contact Number', signals.mobile_number]);
    return rows;
  }

  function listBlock(title, items){
    if(!Array.isArray(items) || !items.length) return '';
    return `<div class="public-extra-list"><strong>${e(title)}</strong><ul>${items.map(x=>`<li>${e(x)}</li>`).join('')}</ul></div>`;
  }

  function renderResult(payload, tender){
    const body = document.getElementById('modalBody');
    if(!body) return;
    body.querySelector('.public-web-section')?.remove();
    const sources = Array.isArray(payload?.sources) ? payload.sources : [];

    if(!sources.length){
      const attempted = Array.isArray(payload?.attempts)
        ? [...new Set(payload.attempts.map(x=>x.source).filter(Boolean))].join(', ')
        : 'TenderKart, BidAssist and TendersPlus';
      body.insertAdjacentHTML('beforeend', `
        <section class="detail-section public-web-section">
          <div class="section-title"><h3>Public Tender Intelligence Search</h3><span class="count-chip">No verified match</span></div>
          <div class="empty-block">Searched ${e(attempted)} using the tender number and tender keywords. No verified public page was found right now. KPPP data above is unchanged.</div>
        </section>`);
      return;
    }

    body.insertAdjacentHTML('beforeend', `
      <section class="detail-section public-web-section">
        <div class="section-title"><h3>Public Tender Intelligence</h3><span class="count-chip">${sources.length} verified source${sources.length===1?'':'s'}</span></div>
        <div class="public-web-note">TenderKart is searched directly through its public tender API. BidAssist and TendersPlus are searched by tender number and tender keywords. Only publicly visible information is used; KPPP remains the main tender record.</div>
        <div class="public-source-list">
          ${sources.map(source => {
            const signals = source.signals || {};
            const rows = signalRows(signals);
            const tags = Array.isArray(signals.tags) ? signals.tags : [];
            const safeUrl = String(source.url || '').startsWith('http') ? source.url : '#';
            return `<article class="public-source-card">
              <div class="public-source-head">
                <div><strong>${e(source.source || source.title || source.host || 'Public tender source')}</strong><small>${e(source.match_method || 'verified match')} • ${e(source.host || '')}</small></div>
                <a href="${e(safeUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>
              </div>
              ${rows.length ? `<div class="public-signal-grid">${rows.map(([k,v])=>`<div><span>${e(k)}</span><strong>${e(v)}</strong></div>`).join('')}</div>` : ''}
              ${signals.work_description ? `<div class="public-extra-list"><strong>Work Description</strong><p>${e(signals.work_description)}</p></div>` : ''}
              ${listBlock('Documents / Certificates Required', signals.documents_required)}
              ${listBlock('Technical Criteria', signals.technical_criteria)}
              ${listBlock('Eligibility Conditions', signals.eligibility)}
              ${listBlock('Tender Document Files', signals.tender_documents)}
              ${listBlock('BOQ Preview', signals.boq_preview)}
              ${tags.length ? `<div class="public-tag-row">${tags.map(tag=>`<span>${e(tag)}</span>`).join('')}</div>` : ''}
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
    btn.textContent = 'Searching TenderKart, BidAssist & TendersPlus…';

    const params = new URLSearchParams({
      tender: tenderRef,
      title: String(tender.title || ''),
      department: String(tender.department || ''),
      location: String(tender.location || tender.derived_city || tender.district || '')
    });

    try{
      const r = await fetch('/api/public_tender_detail?' + params.toString(), {cache:'no-store'});
      if(!r.ok) throw new Error('Public detail search failed');
      const payload = await r.json();
      if(!payload?.success) throw new Error(payload?.message || 'Public detail search failed');
      renderResult(payload, tender);
    }catch{
      const body = document.getElementById('modalBody');
      body?.querySelector('.public-web-section')?.remove();
      body?.insertAdjacentHTML('beforeend', `
        <section class="detail-section public-web-section">
          <div class="section-title"><h3>Public Tender Intelligence</h3></div>
          <div class="empty-block">The external public search is temporarily unavailable. The KPPP tender information above is unaffected.</div>
        </section>`);
    }finally{
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installButton);
  else installButton();
})();
