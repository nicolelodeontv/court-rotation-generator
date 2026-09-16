(()=>{'use strict';
const $=id=>document.getElementById(id);
const toast=msg=>{let t=$('crgToast');if(!t){t=document.createElement('div');t.id='crgToast';document.body.appendChild(t)}t.textContent=msg;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2600)};
const clean=v=>String(v??'').trim();
const title=v=>String(v??'').trim().replace(/\s+/g,' ').replace(/(^|[\s'-])([a-zà-ÿ])/g,(_,p,c)=>p+c.toLocaleUpperCase());
const storedSkills=()=>{try{return JSON.parse(localStorage.getItem('crg-skills-v1')||'{}')||{}}catch{return{}}};
const skillMap=()=>{const names=($('names')?.value||'').split(/\r?\n/).map(clean).filter(Boolean).map(title),src=window.CRG_PLAYER_SKILLS||{},stored=storedSkills(),map={};names.forEach((n,i)=>map[n.toLocaleLowerCase()]=title(src[i+1]||stored[n]||'Intermediate'));return map};
const skillFor=(name,map)=>title(map[clean(name).toLocaleLowerCase()]||'Intermediate');
const buttonLabels={
  copyFrozenSnapshotBtn:'Copy frozen snapshot',
  snapshotLinkBtn:'Copy read-only snapshot',
  resumeBtn:'Resume last session',
  saveSessionBtn:'Save session',
  shareDisplayBtn:'Share display view',
  shareSessionBtn:'Share session schedule',
  restartBtn:'Restart live session',
  printBtn:'Print schedule',
  csvBtn:'Download CSV',
  copyLiveSpectatorBtn:'Copy live spectator link'
};
let lastAction=null,lastActionAt=0;
function showFailure(label,error,button){const message='Something went wrong — check console';console.error(`[${label}] failed:`,error);const old=button?.parentElement?.querySelector(':scope > .session-tool-error');if(old)old.remove();if(button){const p=document.createElement('p');p.className='session-tool-error';p.textContent=message;p.setAttribute('role','alert');button.insertAdjacentElement('afterend',p);setTimeout(()=>p.remove(),5000)}toast(`${label} failed — check console`) }
function markAction(button,label){lastAction={button,label};lastActionAt=Date.now()}
function captureAction(event){const target=event.target?.closest?.('button');if(!target)return;const id=target.id,label=buttonLabels[id];if(!label)return;markAction(target,label)}
function wire(button,label){if(!button||button.dataset.runtimeMonitored==='1')return;button.dataset.runtimeMonitored='1';button.addEventListener('click',()=>markAction(button,label),{capture:true});button.setAttribute('data-runtime-label',label)}
function monitorButtons(){Object.entries(buttonLabels).forEach(([id,label])=>wire($(id),label));document.querySelectorAll('#moreView button').forEach(button=>{const id=button.id;if(buttonLabels[id])wire(button,buttonLabels[id])})}
function snapshotFallback(){
 const map=skillMap(),code=($('sessionCodeText')?.textContent||'').match(/CRG-[A-Z0-9]+/)?.[0]||'';
 if(!code)return null;
 const rows=[...document.querySelectorAll('#scheduleList .game-row')].map((r,i)=>{const match=r.querySelector('.game-match');const direct=[...match?.querySelectorAll(':scope > .schedule-team-players')||[]].map(x=>x.innerText.trim()).filter(Boolean);let rawTeams=direct;if(rawTeams.length<2){const nodes=[...match?.querySelectorAll(':scope > *')||[]].map(x=>x.innerText.trim()).filter(x=>x&&!/^(TEAM A|TEAM B|VS)$/i.test(x));rawTeams=nodes}if(rawTeams.length<2){const raw=clean(match?.innerText).replace(/\s+/g,' '),parts=raw.split(/\s+VS\s+/i);rawTeams=parts}const teams=rawTeams.slice(0,2).map(team=>team.split(/\s*\+\s*/).map(name=>({name:clean(name),skill:skillFor(name,map)})).filter(p=>p.name));const hint=clean(r.querySelector('.hint')?.innerText||'');return{index:i+1,teams,court:(hint.match(/Court\s+(\d+)/i)||[])[1]||'1',status:clean(r.querySelector('.game-status')?.innerText||''),done:r.classList.contains('done'),locked:r.classList.contains('locked')}});
 const rankings=[...document.querySelectorAll('#rankingsList .rank-row')].map(r=>({position:clean(r.querySelector('.rank-pos')?.innerText),name:clean(r.querySelector('.rank-name')?.innerText),record:clean(r.querySelector('.rank-record')?.innerText),winRate:clean(r.querySelector('.rank-pct')?.innerText)}));
 const currentRoot=$('currentTeams');
 const currentTeams=[...currentRoot?.querySelectorAll(':scope > .team')||[]].slice(0,2).map(team=>clean(team.innerText).split(/\s*\+\s*/).map(name=>({name:clean(name),skill:skillFor(name,map)})).filter(p=>p.name));
 const data={version:5,sessionCode:code,season:localStorage.getItem('crg-season-name')||'Court Rotation',current:{game:clean($('currentNo')?.innerText),court:clean($('currentCourt')?.innerText),teams:currentTeams,sitting:clean($('currentSit')?.innerText),status:clean($('liveStatus')?.innerText)},progress:{text:clean($('progressText')?.innerText),percent:clean($('progressPct')?.innerText)},schedule:rows,rankings,updatedAt:new Date().toISOString()};
 return `${location.origin}${location.pathname}?s=${btoa(unescape(encodeURIComponent(JSON.stringify(data))))}&view=spectator`;
}
async function copyFrozenSnapshot(){
 try{
  const legacy=$('snapshotLinkBtn');
  if(legacy?.onclick){return await legacy.onclick()}
  const url=snapshotFallback();
  if(!url)return toast('Generate a rotation first.');
  try{await navigator.clipboard.writeText(url);toast('Frozen snapshot link copied')}catch{prompt('Copy this frozen snapshot link:',url)}
 }catch(error){showFailure('Copy frozen snapshot',error,$('copyFrozenSnapshotBtn'));throw error}
}
function cleanup(){
 const frozen=$('copyFrozenSnapshotBtn');
 if(frozen&&!frozen.dataset.wired){frozen.addEventListener('click',()=>copyFrozenSnapshot().catch(()=>{}));frozen.dataset.wired='1'}
 const legacySnapshot=$('snapshotLinkBtn');if(legacySnapshot)legacySnapshot.remove();
 $('shareDisplayBtn')?.remove();
 $('liveSyncBtn')?.remove();
 const share=$('shareSessionBtn');if(share)share.textContent='Share session schedule';
 let hint=$('sessionToolsHint');
 const stack=document.querySelector('#moreView .card .tool-stack');
 if(stack&&!hint){hint=document.createElement('p');hint.id='sessionToolsHint';hint.className='hint';stack.after(hint)}
 if(hint){const text='Live spectator link is in Live. Frozen snapshots work without a database connection.';if(hint.textContent!==text)hint.textContent=text}
 monitorButtons();
}
window.addEventListener('error',event=>{if(!lastAction||Date.now()-lastActionAt>5000)return;showFailure(lastAction.label,event.error||event.message,lastAction.button)},{capture:true});
window.addEventListener('unhandledrejection',event=>{if(!lastAction||Date.now()-lastActionAt>5000)return;showFailure(lastAction.label,event.reason,lastAction.button)},{capture:true});
document.addEventListener('click',captureAction,true);
function boot(){cleanup();const root=$('moreView');if(!root)return;
// Safe observer: scoped to #moreView and cleanup writes sessionToolsHint idempotently, so it cannot observe and repeat its own write forever.
new MutationObserver(cleanup).observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','id','class']})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
