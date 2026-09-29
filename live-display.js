(()=>{'use strict';
const root=document.getElementById('courtCards');
let collapsedCourts=new Set(),sessionKey='';
const esc=value=>String(value??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
window.CRG_FORMAT_LIVE_PLAYER=(name,skill)=>window.CRG_TEAM_RENDERER?.renderPlayer({name,skill});
function statusLabel(status){return status==='playing'?'PLAYING':status==='waiting'?'WAITING':'COMPLETE'}
function render(model){
  if(!root)return;
  if(!model?.multiCourt){root.hidden=true;return}
  const nextSessionKey=String(model.sessionKey??'');
  if(nextSessionKey!==sessionKey){collapsedCourts=new Set();sessionKey=nextSessionKey}
  root.hidden=false;
  const renderer=window.CRG_TEAM_RENDERER;
  root.innerHTML=(model.courts||[]).map(court=>{
    const courtNumber=Number(court.court||1),collapsed=collapsedCourts.has(courtNumber),playing=court.status==='playing',waiting=court.status==='waiting';
    const timer=court.timerIndex===null||court.timerIndex===undefined?'00:00':'00:00';
    const teams=renderer?.renderMatchup?renderer.renderMatchup(court.teams||[]):'<div class="team">—</div><div class="versus">VS</div><div class="team">—</div>';
    const waitingMarkup=waiting&&court.waitingFor?'<div class="court-card-waiting"><b>WAITING FOR PLAYERS</b><span>Waiting for '+esc(court.waitingFor.player)+' (Court '+Number(court.waitingFor.court||1)+')</span></div>':'';
    return '<article class="court-card '+(collapsed?'is-collapsed':'')+'" data-court-card="'+courtNumber+'" role="listitem">'+
      '<div class="court-card-head"><div class="court-card-summary"><span class="court-card-court">COURT '+courtNumber+'</span><span class="court-card-game">GAME '+(court.gameNo??'—')+'</span><span class="court-card-timer game-timer" '+(court.timerIndex===null||court.timerIndex===undefined?'':'data-timer-index="'+Number(court.timerIndex)+'"')+' aria-live="polite">'+timer+'</span><span class="court-card-status badge">'+statusLabel(court.status)+'</span></div>'+
      '<button type="button" class="court-card-toggle" data-action="toggle-collapse" aria-expanded="'+(!collapsed?'true':'false')+'" aria-label="'+(collapsed?'Expand':'Collapse')+' Court '+courtNumber+'">'+(collapsed?'▸':'▾')+'</button></div>'+
      '<div class="court-card-body">'+
        (court.status==='complete'?'<div class="court-card-complete"><b>COURT '+courtNumber+' COMPLETE</b></div>':('<div class="court-card-matchup matchup">'+teams+'</div><div class="court-card-sit sit">Sitting out: '+((court.sitting||[]).length?(court.sitting||[]).map(esc).join(', '):'None')+'</div>'+waitingMarkup))+
      '</div>'+
      '<div class="court-card-footer"><button type="button" class="btn court-card-complete-btn" data-action="complete" data-court="'+courtNumber+'" '+(playing?'':'disabled')+'>✓ Complete game</button></div>'+
    '</article>';
  }).join('');
}
if(root)root.addEventListener('click',event=>{
  const toggle=event.target.closest('[data-action="toggle-collapse"]');
  if(toggle){
    const card=toggle.closest('[data-court-card]'),court=Number(card?.dataset.courtCard);
    if(!Number.isInteger(court))return;
    if(collapsedCourts.has(court)){collapsedCourts.delete(court)}else{collapsedCourts.add(court)}
    const collapsed=collapsedCourts.has(court);
    card.classList.toggle('is-collapsed',collapsed);
    toggle.setAttribute('aria-expanded',collapsed?'false':'true');
    toggle.setAttribute('aria-label',(collapsed?'Expand':'Collapse')+' Court '+court);
    toggle.textContent=collapsed?'▸':'▾';
    return;
  }
  const complete=event.target.closest('[data-action="complete"]');
  if(complete&&!complete.disabled){
    const court=Number(complete.dataset.court);
    if(Number.isInteger(court))window.CRG_COMPLETE_COURT?.(court);
  }
});
window.CRG_RENDER_LIVE_DISPLAY=render;
})();