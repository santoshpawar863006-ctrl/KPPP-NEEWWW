'use strict';

const H = {
  rows: [],
  filtered: [],
  page: 0,
  size: 100,
  resultCache: new Map(),
};

const $h = id => document.getElementById(id);
const escH = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const moneyH = v => { const n=Number(v); return Number.isFinite(n)&&n>0 ? '₹'+n.toLocaleString('en-IN',{maximumFractionDigits:2}) : '—'; };

function cleanLocationLabel(v){
  const s=String(v||'').trim();
  if(!s) return 'Karnataka';
  return s.replace(/\s+/g,' ');
}

function populateCityFilter(){
  const select=$h('historyCity');
  const current=select.value||'ALL';
  const locations=[...new Set(H.rows.map(t=>cleanLocationLabel(t.location||t.district)).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'en'));
  select.innerHTML='<option value="ALL">All cities / locations</option>'+locations.map(loc=>`<option value="${escH(loc)}">${escH(loc)}</option>`).join('');
  if(locations.includes(current)) select.value=current;
}

async function loadHistory(){
  $h('historyBody').innerHTML='<tr><td colspan="7" class="history-empty">Loading closed KPPP tenders…</td></tr>';
  try{
    const r=await fetch(`/api/history?page=${H.page}&size=${H.size}`,{cache:'no-store'});
    const data=await r.json();
    if(!data.success) throw new Error(data.message||'History unavailable');
    H.rows=Array.isArray(data.tenders)?data.tenders:[];
    populateCityFilter();
    applyHistoryFilters();
    const awarded=H.rows.filter(t=>String(t.status||t.status_text||'').toUpperCase().includes('AWARD')).length;
    $h('historyMeta').textContent=`KPPP history page ${H.page+1} • ${H.rows.length} records • ${awarded} awarded`;
  }catch(e){
    $h('historyBody').innerHTML=`<tr><td colspan="7" class="history-empty">⚠ ${escH(e.message)}</td></tr>`;
  }
}

function applyHistoryFilters(){
  const q=$h('historySearch').value.trim().toLowerCase();
  const cat=$h('historyCategory').value;
  const city=$h('historyCity').value;
  const view=$h('historyView').value;

  H.filtered=H.rows.filter(t=>{
    if(cat!=='ALL' && String(t.category||'').toUpperCase()!==cat) return false;
    if(city!=='ALL' && cleanLocationLabel(t.location||t.district)!==city) return false;
    const status=String(t.status_text||t.status||'').toUpperCase();
    if(view==='AWARDED' && !status.includes('AWARD')) return false;
    if(view==='CLOSED' && status.includes('AWARD')) return false;
    if(q){
      const hay=[t.title,t.ref_no,t.department,t.location,t.district,t.status,t.status_text].filter(Boolean).join(' ').toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  renderHistory();
}

function renderHistory(){
  $h('statClosed').textContent=H.filtered.length.toLocaleString('en-IN');
  $h('statWorks').textContent=H.filtered.filter(t=>String(t.category||'').toUpperCase()==='WORKS').length.toLocaleString('en-IN');
  $h('statAwardHints').textContent=H.filtered.filter(t=>String(t.status_text||t.status||'').toUpperCase().includes('AWARD')).length.toLocaleString('en-IN');
  $h('statResults').textContent=[...H.resultCache.values()].filter(x=>x?.success).length.toLocaleString('en-IN');

  if(!H.filtered.length){
    $h('historyBody').innerHTML='<tr><td colspan="7" class="history-empty">No matching closed/awarded tenders found.</td></tr>';
    return;
  }

  $h('historyBody').innerHTML=H.filtered.map(t=>{
    const ref=t.ref_no||t.id||'';
    const key=encodeURIComponent(ref);
    const status=(t.status_text||t.status||'Closed').trim();
    const cached=H.resultCache.get(ref);
    const isAwarded=String(status).toUpperCase().includes('AWARD');
    return `<tr>
      <td><span class="badge ${escH(String(t.category||'OTHER').toUpperCase())}">${escH(t.category||'OTHER')}</span></td>
      <td><div class="history-title">${escH(t.title||'Tender')}</div><div class="history-ref">${escH(ref)}</div></td>
      <td>${escH(t.department||'Karnataka Government')}<div class="history-ref">${escH(cleanLocationLabel(t.location||t.district))}</div></td>
      <td>${moneyH(t.amount)}</td>
      <td>${escH(t.closing_date||'—')}</td>
      <td><span class="history-status ${isAwarded?'award':'closed'}">${escH(status||'Closed')}</span></td>
      <td>${cached?renderResult(cached,isAwarded):`<button class="result-btn" data-result="${key}">${isAwarded?'Find Contractor':'Check Result'}</button>`}</td>
    </tr>`;
  }).join('');
}

function renderResult(payload,isAwarded=false){
  if(!payload?.success){
    if(payload?.needs_api_key && isAwarded){
      return '<div class="result-box"><small>🏆 KPPP confirms Awarded</small><small class="provisional">Contractor name needs exact award lookup connection.</small></div>';
    }
    return '<div class="result-box"><small>No verified public result found yet.</small></div>';
  }
  const r=payload.result||{};
  if(r.provisional){
    const l1=(r.bidders||[]).find(b=>b.rank==='L1');
    return `<div class="result-box"><strong>${l1?escH(l1.name):'L1 identified'}</strong>${l1?.amount?`<small>${moneyH(l1.amount)}</small>`:''}<small class="provisional">🟡 Provisional L1 — not yet awarded</small><small class="secondary">Secondary: ${escH(r.source||'Public result mirror')}</small></div>`;
  }
  const awardee=(r.bidders||[]).find(b=>b.rank==='AWARDEE')||(r.bidders||[]).find(b=>b.rank==='L1');
  if(r.awarded && awardee){
    return `<div class="result-box"><strong>🏆 ${escH(awardee.name)}</strong><small>${moneyH(r.accepted_amount||awardee.amount)}</small><small>🟢 Awarded / AOC</small><small class="secondary">Secondary: ${escH(r.source||'Public award mirror')}</small></div>`;
  }
  if(awardee){
    return `<div class="result-box"><strong>${escH(awardee.name)}</strong><small>${moneyH(awardee.amount)}</small><small class="provisional">Result found; award not confirmed.</small><small class="secondary">Secondary: ${escH(r.source||'Public result mirror')}</small></div>`;
  }
  return '<div class="result-box"><small>Result page found, but contractor name is not publicly visible.</small></div>';
}

async function checkResult(ref,cell){
  cell.innerHTML='<span class="result-loading">Checking award/result…</span>';
  const row=H.rows.find(t=>(t.ref_no||t.id||'')===ref);
  const isAwarded=String(row?.status_text||row?.status||'').toUpperCase().includes('AWARD');
  try{
    const r=await fetch('/api/award_result?tender='+encodeURIComponent(ref),{cache:'no-store'});
    const data=await r.json();
    H.resultCache.set(ref,data);
    cell.innerHTML=renderResult(data,isAwarded);
    renderContractorSearch();
    $h('statResults').textContent=[...H.resultCache.values()].filter(x=>x?.success).length.toLocaleString('en-IN');
  }catch{
    const data={success:false};
    H.resultCache.set(ref,data);
    cell.innerHTML=renderResult(data,isAwarded);
  }
}

function contractorEntries(){
  const out=[];
  for(const [ref,payload] of H.resultCache.entries()){
    if(!payload?.success) continue;
    const r=payload.result||{};
    for(const bidder of (r.bidders||[])){
      if(!bidder?.name) continue;
      out.push({ref,name:bidder.name,rank:bidder.rank,amount:bidder.amount,awarded:Boolean(r.awarded),provisional:Boolean(r.provisional),source:r.source,url:r.url});
    }
  }
  return out;
}

function renderContractorSearch(){
  const q=$h('contractorSearch').value.trim().toLowerCase();
  const area=$h('contractorResults');
  if(!q){area.innerHTML='<div class="history-empty">Use “Find Contractor” on awarded tenders, then search those verified contractor names here.</div>';return;}
  const hits=contractorEntries().filter(x=>x.name.toLowerCase().includes(q));
  if(!hits.length){area.innerHTML='<div class="history-empty">No checked award/result records match this contractor yet.</div>';return;}
  area.innerHTML=hits.map(x=>`<div class="contractor-hit"><strong>${escH(x.name)}</strong><small>${escH(x.ref)} • ${escH(x.rank)} • ${moneyH(x.amount)} • ${x.awarded?'Awarded':x.provisional?'Provisional L1':'Result'} • ${escH(x.source||'Secondary')}</small></div>`).join('');
}

$h('historyBody').addEventListener('click',e=>{
  const btn=e.target.closest('[data-result]');
  if(!btn) return;
  const ref=decodeURIComponent(btn.dataset.result);
  const cell=btn.closest('td');
  checkResult(ref,cell);
});

$h('historySearch').addEventListener('input',applyHistoryFilters);
['historyCategory','historyCity','historyView'].forEach(id=>$h(id).addEventListener('change',applyHistoryFilters));
$h('contractorSearch').addEventListener('input',renderContractorSearch);
$h('olderPage').addEventListener('click',()=>{H.page++;loadHistory();});
$h('newerPage').addEventListener('click',()=>{if(H.page>0){H.page--;loadHistory();}});

loadHistory();
renderContractorSearch();