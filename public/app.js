'use strict';

const state = {
  all: [],
  filtered: [],
  page: 1,
  pageSize: 50,
  saved: new Set(JSON.parse(localStorage.getItem('kppp_saved_tenders') || '[]')),
  generatedAt: null,
};

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const num = (v) => { const n = Number(String(v ?? '').replace(/[₹,]/g, '').trim()); return Number.isFinite(n) ? n : null; };
const money = (v, fallback='Refer tender') => { const n = num(v); return n === null ? fallback : '₹' + n.toLocaleString('en-IN', {maximumFractionDigits: 2}); };
const fmt = (v) => Number(v || 0).toLocaleString('en-IN');
const text = (v, fallback='Not available') => (v === null || v === undefined || v === '') ? fallback : String(v);
const first = (obj, keys, fallback=null) => { for (const k of keys) if (obj && obj[k] !== null && obj[k] !== undefined && obj[k] !== '') return obj[k]; return fallback; };
const asArray = (v) => Array.isArray(v) ? v : [];

const CITY_ALIASES = {
  'Bengaluru':['bengaluru','bangalore'],'Mysuru':['mysuru','mysore'],'Vijayapura':['vijayapura','bijapur'],
  'Bagalkot':['bagalkot'],'Belagavi':['belagavi','belgaum'],'Kalaburagi':['kalaburagi','gulbarga'],'Bidar':['bidar'],
  'Yadgir':['yadgir'],'Raichur':['raichur'],'Koppal':['koppal'],'Ballari':['ballari','bellary'],'Gadag':['gadag'],
  'Haveri':['haveri'],'Dharwad':['dharwad'],'Uttara Kannada':['uttara kannada','karwar'],'Udupi':['udupi'],
  'Dakshina Kannada':['dakshina kannada','mangaluru','mangalore'],'Shivamogga':['shivamogga','shimoga'],
  'Davangere':['davangere'],'Chitradurga':['chitradurga'],'Tumakuru':['tumakuru','tumkur'],
  'Chikkamagaluru':['chikkamagaluru','chikmagalur'],'Hassan':['hassan'],'Kodagu':['kodagu','madikeri'],
  'Mandya':['mandya'],'Chamarajanagar':['chamarajanagar'],'Ramanagara':['ramanagara','ramanagaram'],
  'Kolar':['kolar'],'Chikkaballapur':['chikkaballapur','chikballapur']
};

function tenderKey(t){ return String(t.id || t.ref_no || `${t.title || ''}|${t.closing_date || ''}`); }
function detectCity(t){
  if (t.city) return String(t.city).trim();
  if (t.district) return String(t.district).trim();
  const hay = [t.location,t.title,t.department].filter(Boolean).join(' ').toLowerCase();
  for (const [city, aliases] of Object.entries(CITY_ALIASES)) if (aliases.some(a => hay.includes(a))) return city;
  return 'Other / Unspecified';
}
function parseDate(v){
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return new Date(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0));
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d;
}
function closingSoon(v){ const d=parseDate(v); if(!d) return false; const ms=d-Date.now(); return ms>=0 && ms<=7*86400000; }

async function loadTenders(){
  try {
    const r = await fetch('/tenders.json?ts=' + Date.now(), {cache:'no-store'});
    if (!r.ok) throw new Error('Unable to load tenders.json');
    const data = await r.json();
    state.generatedAt = data.generated_at || null;
    state.all = asArray(data.tenders).map(t => ({...t, derived_city: detectCity(t)}));
    populateFilters();
    applyFilters();
    $('syncText').textContent = state.generatedAt ? `Last KPPP sync: ${new Date(state.generatedAt).toLocaleString('en-IN')}` : 'KPPP sync time unavailable';
  } catch (e) {
    $('tableBody').innerHTML = `<tr><td colspan="9" class="empty">⚠ ${esc(e.message)}</td></tr>`;
    $('syncText').textContent = 'Tender database unavailable';
  }
}

function populateFilters(){
  fillSelect('cityFilter', [...new Set(state.all.map(t=>t.derived_city).filter(Boolean))].sort(), 'All cities / districts');
  fillSelect('deptFilter', [...new Set(state.all.map(t=>String(t.department||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b)), 'All departments');
}
function fillSelect(id, values, label){
  const el=$(id); el.innerHTML=`<option value="ALL">${esc(label)}</option>` + values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function applyFilters(){
  const q=$('searchInput').value.trim().toLowerCase();
  const cat=$('categoryFilter').value, city=$('cityFilter').value, dept=$('deptFilter').value;
  state.filtered = state.all.filter(t => {
    if (cat !== 'ALL' && String(t.category||'').toUpperCase() !== cat) return false;
    if (city !== 'ALL' && t.derived_city !== city) return false;
    if (dept !== 'ALL' && String(t.department||'') !== dept) return false;
    if (q) {
      const hay=[t.title,t.ref_no,t.id,t.department,t.location,t.district,t.city,t.derived_city,t.category,t.status,t.status_text].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  sortFiltered(); state.page=1; render();
}
function sortFiltered(){
  const mode=$('sortFilter').value;
  state.filtered.sort((a,b)=>{
    if(mode==='CLOSING') return (parseDate(a.closing_date)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (parseDate(b.closing_date)?.getTime() ?? Number.MAX_SAFE_INTEGER);
    if(mode==='AMOUNT') return (num(b.amount)??-1)-(num(a.amount)??-1);
    return (parseDate(b.published_date)?.getTime()??0)-(parseDate(a.published_date)?.getTime()??0);
  });
}
function updateStats(){
  const cats = (c) => state.filtered.filter(t=>String(t.category||'').toUpperCase()===c).length;
  $('statTotal').textContent=fmt(state.filtered.length);
  $('statWorks').textContent=fmt(cats('WORKS'));
  $('statGoods').textContent=fmt(cats('GOODS'));
  $('statServices').textContent=fmt(cats('SERVICES'));
  $('statSoon').textContent=fmt(state.filtered.filter(t=>closingSoon(t.closing_date)).length);
  $('statSaved').textContent=fmt(state.saved.size);
}
function render(){ updateStats(); renderTable(); renderPagination(); $('resultCount').textContent=`${fmt(state.filtered.length)} tenders found`; }

function renderTable(){
  const start=(state.page-1)*state.pageSize, rows=state.filtered.slice(start,start+state.pageSize);
  if(!rows.length){ $('tableBody').innerHTML='<tr><td colspan="9" class="empty">No matching tenders found.</td></tr>'; return; }
  $('tableBody').innerHTML=rows.map(t=>{
    const key=tenderKey(t), saved=state.saved.has(key), cat=String(t.category||'').toUpperCase()||'OTHER';
    const status=text(t.status_text||t.status,'Published');
    return `<tr>
      <td><button class="save-btn ${saved?'saved':''}" data-save="${encodeURIComponent(key)}" title="Save tender">${saved?'♥':'♡'}</button></td>
      <td><span class="badge ${esc(cat)}">${esc(cat)}</span></td>
      <td><div class="t-title">${esc(text(t.title,'Tender'))}</div><div class="muted">${esc(text(t.ref_no||t.id,'No reference'))}</div></td>
      <td><div class="dept">${esc(text(t.department,'Karnataka Government'))}</div><div class="muted">${esc(text(t.derived_city||t.location,'Karnataka'))}</div></td>
      <td class="nowrap"><strong>${esc(money(t.amount,t.amount_display||'Refer tender'))}</strong></td>
      <td class="nowrap">${esc(money(t.emd,'—'))}</td>
      <td><span class="date ${closingSoon(t.closing_date)?'urgent':''}">${esc(text(t.closing_date,'—'))}</span></td>
      <td><span class="status-pill">${esc(status)}</span></td>
      <td><button class="details-btn" data-detail="${encodeURIComponent(key)}">View Details</button></td>
    </tr>`;
  }).join('');
}
function renderPagination(){
  const pages=Math.max(1,Math.ceil(state.filtered.length/state.pageSize));
  if(state.page>pages) state.page=pages;
  $('pagination').innerHTML=`<button ${state.page<=1?'disabled':''} id="prevPage">← Previous</button><span>Page ${state.page} of ${pages}</span><button ${state.page>=pages?'disabled':''} id="nextPage">Next →</button>`;
  $('prevPage')?.addEventListener('click',()=>{state.page--;renderTable();renderPagination();scrollToResults();});
  $('nextPage')?.addEventListener('click',()=>{state.page++;renderTable();renderPagination();scrollToResults();});
}
function scrollToResults(){ $('resultsPanel').scrollIntoView({behavior:'smooth',block:'start'}); }

function toggleSaved(key){
  state.saved.has(key)?state.saved.delete(key):state.saved.add(key);
  localStorage.setItem('kppp_saved_tenders',JSON.stringify([...state.saved])); render();
}
function resetFilters(){
  $('searchInput').value=''; $('categoryFilter').value='ALL'; $('cityFilter').value='ALL'; $('deptFilter').value='ALL'; $('sortFilter').value='NEWEST'; applyFilters();
}

async function openDetails(key){
  const tender=state.all.find(t=>tenderKey(t)===key); if(!tender) return;
  $('detailModal').classList.add('open'); document.body.classList.add('modal-open');
  $('modalTitle').textContent=tender.title||'Tender Details';
  $('modalSub').textContent=[tender.category,tender.ref_no||tender.id,tender.department].filter(Boolean).join(' • ');
  $('modalBody').innerHTML=renderListingFallback(tender,true);

  const raw=tender.raw||{};
  const nitId=first(raw,['nitId','nitID','id','tenderId'],tender.id||'');
  const params=new URLSearchParams({category:String(tender.category||''),id:String(tender.id||''),nitId:String(nitId||'')});
  try{
    const r=await fetch('/api/tender_detail?'+params.toString(),{cache:'no-store'});
    if(!r.ok) throw new Error(`Detail API returned HTTP ${r.status}`);
    const payload=await r.json();
    if(payload && payload.success && payload.detail){
      $('modalBody').innerHTML=renderLiveDetail(tender,payload.detail);
    } else {
      $('modalBody').innerHTML=renderListingFallback(tender,false,payload?.message||'KPPP full-detail data is not available for this tender yet.');
    }
  }catch(e){
    $('modalBody').innerHTML=renderListingFallback(tender,false,'Live KPPP detail could not be loaded. The tender-list information is still shown below.');
  }
}

function renderListingFallback(t,loading=false,message=''){
  const raw=t.raw||{};
  return `${loading?'<div class="live-banner loading"><span class="spinner"></span> Loading full tender details from KPPP…</div>':`<div class="live-banner warning">⚠ ${esc(message)}</div>`}
    <section class="detail-section"><div class="section-title"><h3>Overview</h3><span class="source-chip">Tender list data</span></div>
      <div class="metric-grid">
        ${metric('Estimated Value',money(t.amount,t.amount_display||'Refer tender'))}
        ${metric('EMD',money(t.emd,'Refer tender'))}
        ${metric('Tender Fee',money(t.fee,'Refer tender'))}
        ${metric('Closing',text(t.closing_date,'Not available'))}
      </div>
      <div class="info-grid">
        ${info('Tender Number',t.ref_no||t.id)} ${info('Category',t.category)} ${info('Department',t.department)}
        ${info('Location',t.location||t.derived_city)} ${info('Published',t.published_date)} ${info('Status',t.status_text||t.status)}
      </div>
    </section>
    ${renderRaw(raw)}`;
}

function renderLiveDetail(listing,d){
  const nit=d.noticeInvitingTenderDTO||{}; const sched=d.tenderSchedule||{};
  const title=first(sched,['title','description'],listing.title); if(title) $('modalTitle').textContent=title;
  const ecv=first(sched,['ecv','provisionalAmount'],listing.amount); const emd=first(nit,['emd','emdAmount'],listing.emd); const fee=first(nit,['tenderFee','tenderFeeAmount'],listing.fee);
  const subEst=asArray(d.tenderSubEstimateList), general=asArray(d.generalCriterionList), technical=asArray(d.technicalCriterionList), docs=asArray(d.tenderCriterionDocumentList);
  const boq=subEst.flatMap(se=>asArray(se.itemList).map(item=>({...item,__group:se.subEstimateName||se.workCategoryName||''})));
  return `<div class="live-banner success">✓ Full details loaded from KPPP</div>
    <section class="detail-section"><div class="section-title"><h3>Overview</h3><span class="source-chip live">Live detail</span></div>
      <div class="metric-grid">
        ${metric('Estimated Contract Value',money(ecv,'Refer tender'))}
        ${metric('EMD',money(emd,'Refer tender'))}
        ${metric('Tender Fee',money(fee,'Refer tender'))}
        ${metric('Bid Validity',first(nit,['bidValidityPeriod']) ? first(nit,['bidValidityPeriod'])+' days' : 'Not available')}
      </div>
      <div class="info-grid">
        ${info('Tender Number',first(sched,['tenderNumber'],listing.ref_no||listing.id))}
        ${info('Category',first(sched,['categoryText','category'],listing.category))}
        ${info('Department',first(sched,['deptName'],listing.department))}
        ${info('Location',first(sched,['locationName'],listing.location||listing.derived_city))}
        ${info('Tender Type',first(nit,['tenderType','invitingStrategyText','invitingStrategy']))}
        ${info('Evaluation',first(nit,['evaluationTypeText','evaluationType']))}
        ${info('Bid Type',first(nit,['bidValueTypeText','bidValueType']))}
        ${info('No. of Calls',first(nit,['noOfCalls']))}
      </div>
      ${first(sched,['description'])?`<div class="description-box"><strong>Description</strong><p>${esc(first(sched,['description']))}</p></div>`:''}
    </section>

    <section class="detail-section"><div class="section-title"><h3>Important Dates & Contact</h3></div>
      <div class="info-grid">
        ${info('Published',first(nit,['publishedDate'],listing.published_date))}
        ${info('Bid Submission Closes',first(nit,['tenderReceiptClose'],listing.closing_date))}
        ${info('Query Closes',first(nit,['tenderQueryClose']))}
        ${info('Technical Bid Opens',first(nit,['technicalBidOpen']))}
        ${info('Pre-bid Meeting',first(nit,['preBidMeetingDate']))}
        ${info('Contact Person',first(nit,['contactPerson']))}
        ${info('Mobile',first(nit,['mobileNumber']))}
        ${info('Office Number',first(nit,['officeNumber']))}
      </div>
    </section>

    ${renderBoq(boq,subEst)}
    ${renderCriteria('Eligibility Conditions',general,'eligibility')}
    ${renderCriteria('Technical Criteria',technical,'technical')}
    ${renderDocuments(docs,technical,general)}
    ${renderOtherLive(d)}`;
}

function metric(label,value){return `<div class="metric"><span>${esc(label)}</span><strong>${esc(text(value))}</strong></div>`;}
function info(label,value){return `<div class="info"><span>${esc(label)}</span><strong>${esc(text(value))}</strong></div>`;}

function renderBoq(items,subEst){
  if(!items.length) return '<section class="detail-section"><div class="section-title"><h3>BOQ / Estimate</h3></div><div class="empty-block">BOQ items were not returned for this tender.</div></section>';
  const total=items.reduce((s,i)=>s+(num(i.netAmount)||0),0);
  return `<section class="detail-section"><div class="section-title"><h3>BOQ / Estimate</h3><span class="count-chip">${fmt(items.length)} items</span></div>
    ${subEst.length?`<div class="subestimate-row">${subEst.map(s=>`<div><span>${esc(text(s.workCategoryName,'Estimate'))}</span><strong>${esc(money(s.estimateTotal,'—'))}</strong></div>`).join('')}</div>`:''}
    <div class="boq-wrap"><table class="boq-table"><thead><tr><th>#</th><th>Item</th><th>Description</th><th>Unit</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>
      ${items.map((i,idx)=>`<tr><td>${idx+1}</td><td><strong>${esc(text(i.itemCode,'—'))}</strong><small>${esc(text(i.categoryName,''))}</small></td><td class="desc">${esc(text(i.description,'—'))}</td><td>${esc(text(i.uomName,'—'))}</td><td class="right">${esc(text(i.quantity,'—'))}</td><td class="right">${esc(money(first(i,['finalRate','baseRate']),'—'))}</td><td class="right"><strong>${esc(money(i.netAmount,'—'))}</strong></td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="6">BOQ total</td><td class="right"><strong>${esc(money(total,'—'))}</strong></td></tr></tfoot></table></div>
  </section>`;
}

function renderCriteria(title,items,type){
  const clean=items.filter(i=>first(i,['description','criterionTypeOthersValue']));
  if(!clean.length) return '';
  return `<section class="detail-section"><div class="section-title"><h3>${esc(title)}</h3><span class="count-chip">${clean.length}</span></div><div class="criteria-list">
    ${clean.map(i=>`<div class="criterion"><span class="check">✓</span><div><strong>${type==='technical'?esc(text(i.criterionCategoryText||i.criterionType,'')):esc(text(i.criterionType,''))}</strong><p>${esc(text(first(i,['description','criterionTypeOthersValue'])))}</p></div></div>`).join('')}
  </div></section>`;
}

function collectNestedDocs(technical,general){
  const out=[];
  for(const i of technical) out.push(...asArray(i.tenderTechnicalCriterionDocumentList));
  for(const i of general) out.push(...asArray(i.tenderEligibilityCriterionDocumentList));
  return out;
}
function renderDocuments(docs,technical,general){
  const all=[...docs,...collectNestedDocs(technical,general)].filter(Boolean);
  const seen=new Set(); const unique=all.filter(d=>{const k=first(d,['documentName','name','fileName']); if(!k||seen.has(k)) return false; seen.add(k); return true;});
  if(!unique.length) return '<section class="detail-section"><div class="section-title"><h3>Required Documents</h3></div><div class="empty-block">No document checklist was returned in this detail response.</div></section>';
  return `<section class="detail-section"><div class="section-title"><h3>Required Documents</h3><span class="count-chip">${unique.length}</span></div><div class="document-grid">
    ${unique.map(d=>`<div class="doc-card"><span>📄</span><div><strong>${esc(text(first(d,['documentName','name','fileName']),'Document'))}</strong><small>${esc(text(first(d,['documentTypeText','documentType']),'Tender document'))}${d.optional===false?' • Mandatory':d.optional===true?' • Listed optional':''}</small></div></div>`).join('')}
  </div></section>`;
}
function renderOtherLive(d){
  const keys=['tenderAddress','tenderRecallDTO','corrigendumList','addendumList','tenderCorrigendumList','tenderAddendumList'];
  const found=keys.filter(k=>d[k] && (Array.isArray(d[k])?d[k].length:true));
  if(!found.length) return '';
  return `<section class="detail-section"><div class="section-title"><h3>Other KPPP Information</h3></div><div class="raw-grid">${found.map(k=>`<div><span>${esc(k)}</span><pre>${esc(JSON.stringify(d[k],null,2))}</pre></div>`).join('')}</div></section>`;
}
function renderRaw(raw){
  if(!raw || typeof raw!=='object') return '';
  const entries=Object.entries(raw).filter(([,v])=>v!==null&&v!==''&&typeof v!=='object').slice(0,30);
  if(!entries.length) return '';
  return `<section class="detail-section subdued"><div class="section-title"><h3>Other Listing Information</h3></div><div class="raw-list">${entries.map(([k,v])=>`<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div></section>`;
}
function closeModal(){ $('detailModal').classList.remove('open'); document.body.classList.remove('modal-open'); }

function bindEvents(){
  let searchTimer;
  $('searchInput').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(applyFilters,180);});
  ['categoryFilter','cityFilter','deptFilter'].forEach(id=>$(id).addEventListener('change',applyFilters));
  $('sortFilter').addEventListener('change',()=>{sortFiltered();state.page=1;render();});
  $('resetBtn').addEventListener('click',resetFilters);
  $('tableBody').addEventListener('click',(e)=>{
    const save=e.target.closest('[data-save]'); if(save){toggleSaved(decodeURIComponent(save.dataset.save));return;}
    const detail=e.target.closest('[data-detail]'); if(detail) openDetails(decodeURIComponent(detail.dataset.detail));
  });
  $('modalClose').addEventListener('click',closeModal);
  $('detailModal').addEventListener('click',(e)=>{if(e.target===$('detailModal')) closeModal();});
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape') closeModal();});
  document.querySelectorAll('[data-cat]').forEach(btn=>btn.addEventListener('click',()=>{$('categoryFilter').value=btn.dataset.cat;applyFilters();}));
}

bindEvents();
loadTenders();