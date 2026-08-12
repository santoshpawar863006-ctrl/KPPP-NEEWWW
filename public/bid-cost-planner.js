'use strict';

(() => {
  const SETTINGS_KEY = 'kppp_bid_cost_planner_v1';
  const AI_COOLDOWN_KEY = 'kppp_bid_ai_last_call_v1';
  const MAX_OPTIONS = 300;
  let currentTender = null;
  let tenderKartSignals = null;
  let lastResult = null;
  let injectionTimer = null;

  const profiles = {
    WORKS: { direct: 80, overhead: 5, contingency: 3, savings: 0, margin: 8 },
    GOODS: { direct: 90, overhead: 3, contingency: 2, savings: 0, margin: 6 },
    SERVICES: { direct: 75, overhead: 8, contingency: 4, savings: 0, margin: 10 },
    DEFAULT: { direct: 80, overhead: 5, contingency: 3, savings: 0, margin: 8 }
  };

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }
  function numeric(value){
    if(value === null || value === undefined || value === '') return null;
    const n = Number(String(value).replace(/[₹,]/g,'').trim());
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function positive(value){ const n=numeric(value); return n!==null && n>0 ? n : null; }
  function money(value, fallback='—'){
    const n = numeric(value);
    return n === null ? fallback : '₹' + n.toLocaleString('en-IN',{maximumFractionDigits:2});
  }
  function pct(value){
    const n=Number(value);
    return Number.isFinite(n) ? `${n.toFixed(2)}%` : '—';
  }
  function readSettings(){
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveSettings(settings){
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  }
  function keyOf(t){ return String(t?.ref_no || t?.id || ''); }
  function categoryOf(t){
    const c=String(t?.category||'').toUpperCase();
    return profiles[c] ? c : 'DEFAULT';
  }
  function rows(){
    try { return Array.isArray(state.filtered) ? state.filtered : []; }
    catch { return []; }
  }
  function profileFor(t){
    const category=categoryOf(t);
    const saved=readSettings();
    return { ...profiles[category], ...(saved[category] || {}) };
  }
  function setValue(id,value){ const el=document.getElementById(id); if(el) el.value = value ?? ''; }
  function getNum(id,fallback=0){
    const el=document.getElementById(id); const n=Number(el?.value);
    return Number.isFinite(n) ? n : fallback;
  }
  function clamp(n,min,max){ return Math.min(max,Math.max(min,n)); }

  function inject(){
    const panel=document.getElementById('analyticsPanel');
    if(!panel || panel.hidden || document.getElementById('bidCostPlanner')) return;

    const available=rows();
    const options=available.slice(0,MAX_OPTIONS).map((t,i)=>{
      const ref=keyOf(t) || `Tender ${i+1}`;
      const title=String(t.title||'').replace(/\s+/g,' ').trim();
      return `<option value="${esc(ref)}">${esc(ref)} — ${esc(title.slice(0,90))}</option>`;
    }).join('');

    panel.insertAdjacentHTML('beforeend', `
      <section class="bid-cost-planner" id="bidCostPlanner">
        <div class="bcp-head">
          <div>
            <h4>Bid Price & Site Cost Planner</h4>
            <p>Planning estimate only — edit the assumptions using your BOQ, supplier quotations, labour rates and site conditions before bidding.</p>
          </div>
          <span class="bcp-badge">Contractor tool</span>
        </div>

        <div class="bcp-tender-row">
          <label>
            <span>Select tender from current filtered list</span>
            <select id="bcpTenderSelect">${options || '<option value="">No filtered tenders</option>'}</select>
          </label>
          <small>${available.length>MAX_OPTIONS?`Showing first ${MAX_OPTIONS}. Narrow the normal filters/search to find a specific tender.`:'Uses the tender currently visible in Analytics.'}</small>
        </div>

        <div class="bcp-layout">
          <div class="bcp-input-card">
            <h5>Cost assumptions</h5>
            <div class="bcp-input-grid">
              <label><span>Tender Value / ECV (₹)</span><input id="bcpEcv" type="number" min="0" step="1000"></label>
              <label><span>Direct execution cost (% of ECV)</span><input id="bcpDirect" type="number" min="0" max="150" step="0.5"></label>
              <label><span>Site overhead (% of ECV)</span><input id="bcpOverhead" type="number" min="0" max="50" step="0.5"></label>
              <label><span>Contingency / risk (% of ECV)</span><input id="bcpContingency" type="number" min="0" max="50" step="0.5"></label>
              <label><span>Local procurement saving on direct cost (%)</span><input id="bcpSavings" type="number" min="0" max="50" step="0.5"></label>
              <label><span>Target profit margin on bid (%)</span><input id="bcpMargin" type="number" min="0" max="50" step="0.5"></label>
            </div>
            <div class="bcp-note" id="bcpAssumptionNote"></div>
          </div>

          <div class="bcp-output-card">
            <h5>Bid planning result</h5>
            <div class="bcp-metrics" id="bcpMetrics"></div>
            <div class="bcp-status" id="bcpStatus"></div>
          </div>
        </div>

        <div class="bcp-detail-strip" id="bcpDetailStrip"></div>

        <div class="bcp-ai">
          <div>
            <h5>Free AI Bid Review</h5>
            <p>Uses Cloudflare Workers AI to review the selected tender and your assumptions. It does not replace BOQ rate analysis.</p>
          </div>
          <button type="button" id="bcpAiBtn">✦ Ask AI to Review</button>
        </div>
        <div class="bcp-ai-result" id="bcpAiResult" hidden></div>
      </section>`);

    document.getElementById('bcpTenderSelect')?.addEventListener('change',selectTender);
    ['bcpEcv','bcpDirect','bcpOverhead','bcpContingency','bcpSavings','bcpMargin'].forEach(id=>{
      document.getElementById(id)?.addEventListener('input',calculate);
      document.getElementById(id)?.addEventListener('change',saveCurrentProfile);
    });
    document.getElementById('bcpAiBtn')?.addEventListener('click',askAi);
    selectTender();
  }

  function selectTender(){
    const select=document.getElementById('bcpTenderSelect');
    const ref=String(select?.value||'').trim();
    currentTender=rows().find(t=>keyOf(t)===ref) || rows()[0] || null;
    tenderKartSignals=null;
    const p=profileFor(currentTender);
    setValue('bcpEcv',positive(currentTender?.amount) || '');
    setValue('bcpDirect',p.direct);
    setValue('bcpOverhead',p.overhead);
    setValue('bcpContingency',p.contingency);
    setValue('bcpSavings',p.savings);
    setValue('bcpMargin',p.margin);
    const category=categoryOf(currentTender);
    const note=document.getElementById('bcpAssumptionNote');
    if(note) note.innerHTML=`Starting profile: <strong>${esc(category)}</strong>. These percentages are editable assumptions, not measured site rates or BOQ-derived costs.`;
    renderTenderStrip();
    calculate();
  }

  function saveCurrentProfile(){
    if(!currentTender) return;
    const category=categoryOf(currentTender);
    const settings=readSettings();
    settings[category]={
      direct:getNum('bcpDirect',profiles[category]?.direct||80),
      overhead:getNum('bcpOverhead',profiles[category]?.overhead||5),
      contingency:getNum('bcpContingency',profiles[category]?.contingency||3),
      savings:getNum('bcpSavings',0),
      margin:getNum('bcpMargin',8)
    };
    saveSettings(settings);
  }

  function calculate(){
    const ecv=positive(getNum('bcpEcv',0));
    const directPct=clamp(getNum('bcpDirect',0),0,150);
    const overheadPct=clamp(getNum('bcpOverhead',0),0,50);
    const contingencyPct=clamp(getNum('bcpContingency',0),0,50);
    const savingsPct=clamp(getNum('bcpSavings',0),0,50);
    const marginPct=clamp(getNum('bcpMargin',0),0,50);
    const metrics=document.getElementById('bcpMetrics');
    const status=document.getElementById('bcpStatus');
    if(!metrics || !status) return;

    if(!ecv){
      metrics.innerHTML='<div class="bcp-empty">Tender value is unavailable. Enter the ECV manually or use a tender with a verified value.</div>';
      status.innerHTML='';
      lastResult=null;
      return;
    }

    const directBase=ecv*(directPct/100);
    const savings=directBase*(savingsPct/100);
    const adjustedDirect=directBase-savings;
    const overhead=ecv*(overheadPct/100);
    const contingency=ecv*(contingencyPct/100);
    const siteCost=adjustedDirect+overhead+contingency;
    const targetBid=marginPct<100 ? siteCost/(1-marginPct/100) : null;
    const profit=targetBid===null?null:targetBid-siteCost;
    const targetDiscount=targetBid===null?null:((ecv-targetBid)/ecv)*100;
    const breakEvenDiscount=((ecv-siteCost)/ecv)*100;
    const costShare=(siteCost/ecv)*100;

    lastResult={
      ecv,directPct,overheadPct,contingencyPct,savingsPct,marginPct,
      directBase,savings,adjustedDirect,overhead,contingency,siteCost,targetBid,profit,targetDiscount,breakEvenDiscount,costShare
    };

    metrics.innerHTML=`
      ${metric('Estimated site cost',money(siteCost),'Based only on your assumptions')}
      ${metric('Break-even bid',money(siteCost),'Below this = modelled loss')}
      ${metric('Indicative target bid',money(targetBid),'At your target profit margin')}
      ${metric('Expected profit',money(profit),`${marginPct.toFixed(1)}% margin on target bid`)}
      ${metric('Target discount vs ECV',pct(targetDiscount),targetDiscount>=0?'Bid below ECV':'Bid above ECV')}
      ${metric('Max ECV discount at break-even',pct(breakEvenDiscount),'Before profit becomes negative')}
    `;

    const warnings=[];
    if(costShare>=100) warnings.push('Your modelled site cost is already at or above the tender value. Re-rate the work before considering a bid.');
    else if(costShare>=95) warnings.push('Very little headroom remains after estimated execution cost. Small BOQ/rate errors can erase profit.');
    if(targetBid!==null && targetBid>ecv) warnings.push('Your target profit requires a bid above the stated ECV under these assumptions.');
    if(directPct+overheadPct+contingencyPct<60) warnings.push('The entered cost percentages are unusually low for a planning model. Verify that major cost heads are not missing.');
    status.className='bcp-status '+(warnings.length?'warn':'ok');
    status.innerHTML=warnings.length ? `⚠ ${warnings.map(esc).join(' ')}` : '✓ The target bid is internally consistent with the assumptions entered. Verify BOQ quantities, current rates, taxes, contract conditions and site risks before submission.';
  }

  function metric(label,value,small){
    return `<div class="bcp-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(small)}</small></div>`;
  }

  function renderTenderStrip(){
    const strip=document.getElementById('bcpDetailStrip'); if(!strip) return;
    if(!currentTender){ strip.innerHTML=''; return; }
    const days=daysLeft(currentTender.closing_date);
    strip.innerHTML=`
      <span><b>Tender:</b> ${esc(keyOf(currentTender)||'—')}</span>
      <span><b>Category:</b> ${esc(currentTender.category||'—')}</span>
      <span><b>Department:</b> ${esc(currentTender.department||'—')}</span>
      <span><b>Location:</b> ${esc(currentTender.derived_city||currentTender.location||'—')}</span>
      <span><b>Closing:</b> ${esc(currentTender.closing_date||'—')}${days===null?'':` (${days<0?'closed':days+' days left'})`}</span>`;
  }

  function daysLeft(v){
    if(!v) return null;
    let d;
    try { d=typeof parseDate==='function'?parseDate(v):new Date(v); }
    catch { d=new Date(v); }
    if(!d || Number.isNaN(d.getTime())) return null;
    return Math.ceil((d.getTime()-Date.now())/86400000);
  }

  async function loadTenderKart(){
    if(tenderKartSignals || !currentTender) return tenderKartSignals;
    const params=new URLSearchParams({
      tender:keyOf(currentTender),
      title:String(currentTender.title||''),
      department:String(currentTender.department||''),
      location:String(currentTender.location||currentTender.derived_city||''),
      source:'tenderkart'
    });
    try{
      const r=await fetch('/api/public_tender_detail?'+params.toString(),{cache:'no-store'});
      const data=r.ok?await r.json():null;
      const tk=Array.isArray(data?.sources)?data.sources.find(x=>String(x?.source||'').toLowerCase()==='tenderkart'):null;
      tenderKartSignals=tk?.signals||null;
      if(!positive(getNum('bcpEcv',0)) && positive(tenderKartSignals?.tender_value)){
        setValue('bcpEcv',tenderKartSignals.tender_value);
        calculate();
      }
    }catch{}
    return tenderKartSignals;
  }

  async function askAi(){
    const btn=document.getElementById('bcpAiBtn');
    const box=document.getElementById('bcpAiResult');
    if(!btn || !box || !currentTender) return;
    calculate();
    if(!lastResult){
      box.hidden=false; box.textContent='Enter a valid Tender Value / ECV first.'; return;
    }
    const last=Number(localStorage.getItem(AI_COOLDOWN_KEY)||0);
    const wait=Math.ceil((45000-(Date.now()-last))/1000);
    if(wait>0){ box.hidden=false; box.textContent=`Please wait ${wait}s before requesting another AI review.`; return; }

    btn.disabled=true; btn.textContent='Reviewing…';
    box.hidden=false; box.innerHTML='<span class="bcp-ai-loading">Cloudflare AI is reviewing the tender and your assumptions…</span>';
    await loadTenderKart();

    const payload={
      tender:{
        ref:keyOf(currentTender), title:currentTender.title||'', category:currentTender.category||'', department:currentTender.department||'',
        city:currentTender.derived_city||'', location:currentTender.location||'', amount:positive(currentTender.amount), emd:positive(currentTender.emd),
        closing_date:currentTender.closing_date||''
      },
      assumptions:{
        direct_cost_pct:lastResult.directPct, overhead_pct:lastResult.overheadPct, contingency_pct:lastResult.contingencyPct,
        local_saving_pct:lastResult.savingsPct, target_profit_margin_pct:lastResult.marginPct
      },
      calculations:{
        ecv:lastResult.ecv, estimated_site_cost:lastResult.siteCost, break_even_bid:lastResult.siteCost,
        indicative_target_bid:lastResult.targetBid, expected_profit:lastResult.profit,
        target_discount_vs_ecv_pct:lastResult.targetDiscount, max_break_even_discount_pct:lastResult.breakEvenDiscount
      },
      tenderkart:tenderKartSignals ? {
        tender_class:tenderKartSignals.tender_class||null, reservation:tenderKartSignals.reservation||null,
        kpwd_class:tenderKartSignals.kpwd_class||null, bid_value_type:tenderKartSignals.bid_value_type||null,
        tax_type:tenderKartSignals.tax_type||null, bid_validity_days:tenderKartSignals.bid_validity_days||null,
        eligibility:(tenderKartSignals.eligibility||[]).slice(0,8),
        technical_criteria:(tenderKartSignals.technical_criteria||[]).slice(0,8),
        documents_required:(tenderKartSignals.documents_required||[]).slice(0,8),
        boq_preview:(tenderKartSignals.boq_preview||[]).slice(0,8)
      } : null
    };

    try{
      const r=await fetch('/api/bid_ai',{
        method:'POST', headers:{'Content-Type':'application/json','X-KPPP-Bid-AI':'1'}, body:JSON.stringify(payload)
      });
      const data=await r.json().catch(()=>({}));
      if(!r.ok || !data?.success) throw new Error(data?.message||'AI review is temporarily unavailable.');
      localStorage.setItem(AI_COOLDOWN_KEY,String(Date.now()));
      box.textContent=String(data.review||'No AI review returned.');
    }catch(err){
      box.textContent=String(err?.message||'AI review is temporarily unavailable. The cost calculator above still works normally.');
    }finally{
      btn.disabled=false; btn.textContent='✦ Ask AI to Review';
    }
  }

  function scheduleInject(){
    clearTimeout(injectionTimer);
    injectionTimer=setTimeout(inject,60);
  }

  const observer=new MutationObserver(scheduleInject);
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  document.addEventListener('click',e=>{ if(e.target?.id==='analyticsToggle') setTimeout(scheduleInject,80); });
  window.addEventListener('load',scheduleInject);
})();
