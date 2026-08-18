'use strict';

(() => {
  const STORAGE_KEY = 'kppp_general_claude_v1';
  const MAX_TURNS = 24;
  let turns = [];
  let busy = false;

  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) turns = saved.slice(-MAX_TURNS);
  } catch {}

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const byId = (id) => document.getElementById(id);

  function save(){ try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-MAX_TURNS))); } catch {} }
  function render(){
    const host = byId('claudeThread'); if(!host) return;
    if(!turns.length){ host.innerHTML='<div class="claude-msg"><div class="claude-bubble"><strong>Claude</strong><br>Ask me anything — construction, coding, business, writing, calculations, tenders, documents, planning, or general questions.</div></div>'; return; }
    host.innerHTML = turns.map(t=>`<div class="claude-msg ${t.role==='user'?'user':''}"><div class="claude-bubble">${esc(t.content)}</div></div>`).join('');
    host.scrollTop=host.scrollHeight;
  }
  function status(t){ const el=byId('claudeStatus'); if(el) el.textContent=t||''; }
  function setBusy(v){ busy=v; const s=byId('claudeSend'),c=byId('claudeClear'),i=byId('claudeInput'); if(s){s.disabled=v;s.textContent=v?'Thinking…':'Send';} if(c)c.disabled=v; if(i)i.disabled=v; }
  async function send(){
    if(busy) return;
    const input=byId('claudeInput'); const q=String(input?.value||'').trim(); if(!q){status('Type a message first.');return;}
    const history=turns.slice(-12).map(({role,content})=>({role,content}));
    turns.push({role:'user',content:q}); turns=turns.slice(-MAX_TURNS); save(); render(); input.value=''; setBusy(true); status('Claude is thinking…');
    try{
      const r=await fetch('/api/claude',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,history}),cache:'no-store'});
      const p=await r.json().catch(()=>({success:false,message:'Invalid response'}));
      if(!r.ok||!p.success) throw new Error(p.message||`Request failed (${r.status})`);
      turns.push({role:'assistant',content:String(p.answer||'').trim()}); turns=turns.slice(-MAX_TURNS); save(); render(); status('Ready');
    }catch(e){status(String(e?.message||e).slice(0,220));}finally{setBusy(false);input?.focus();}
  }
  function bind(){
    byId('claudeFab')?.addEventListener('click',()=>{byId('claudePanel')?.classList.toggle('open'); if(byId('claudePanel')?.classList.contains('open')) byId('claudeInput')?.focus();});
    byId('claudeClose')?.addEventListener('click',()=>byId('claudePanel')?.classList.remove('open'));
    byId('claudeForm')?.addEventListener('submit',e=>{e.preventDefault();send();});
    byId('claudeInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
    byId('claudeClear')?.addEventListener('click',()=>{turns=[];save();render();status('Chat cleared.');});
    render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();