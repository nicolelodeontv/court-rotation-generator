(()=>{'use strict';
const $=id=>document.getElementById(id);
const toast=msg=>{let t=$('crgToast');if(!t){t=document.createElement('div');t.id='crgToast';document.body.appendChild(t)}t.textContent=msg;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2200)};
const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const clean=v=>String(v??'').trim();
const title=v=>String(v??'').trim().replace(/\s+/g,' ').replace(/(^|[\s'-])([a-zà-ÿ])/g,(_,p,c)=>p+c.toLocaleUpperCase());
const storedSkills=()=>{try{return JSON.parse(localStorage.getItem('crg-skills-v1')||'{}')||{}}catch{return{}}};
const skillMap=()=>{const names=($('names')?.value||'').split(/\r?\n/).map(clean).filter(Boolean).map(title),src=window.CRG_PLAYER_SKILLS||{},stored=storedSkills(),map={};names.forEach((n,i)=>map[n.toLocaleLowerCase()]=title(src[i+1]||stored[n]||'Intermediate'));return map};
const skillFor=(name,map)=>title(map[clean(name).toLocaleLowerCase()]||'Intermediate');
function snapshotFallback(){
 const map=skillMap();
 const code=($('sessionCodeText')?.textContent||'').match(/CRG-[A-Z0-9]+/)?.[0]||'';
 if(!code)return null;
 const rows=[...document.querySelectorAll('#scheduleList .game-row')].map((r,i)=>{
  const match=r.querySelector('.game-match');
  const direct=[...match?.querySelectorAll(':scope > .schedule-team-players')||[]].map(x=>x.innerText.trim()).filter(Boolean);
  let rawTeams=direct;
  if(rawTeams.length<2){const nodes=[...match?.querySelectorAll(':scope > *')||[]].map(x=>x.innerText.trim()).filter(x=>x&&!/^(TEAM A|TEAM B|VS)$/i.test(x));rawTeams=nodes}
  if(rawTeams.length<2){const raw=clean(match?.innerText).replace(/\s+/g,' '),parts=raw.split(/\s+VS\s+/i);rawTeams=parts}
  const teams=rawTeams.slice(0,2).map(team=>team.split(/\s*\+\s*/).map(name=>({name:clean(name),skill:skillFor(name,map)})).filter(p=>p.name));
  const hint=clean(r.querySelector('.hint')?.innerText||'');
  return{index:i+1,teams,court:(hint.match(/Court\s+(\d+)/i)||[])[1]||'1',status:clean(r.querySelector('.game-status')?.innerText||''),done:r.classList.contains('done'),locked:r.classList.contains('locked')};
 });
 const rankings=[...document.querySelectorAll('#rankingsList .rank-row')].map(r=>({position:clean(r.querySelector('.rank-pos')?.innerText),name:clean(r.querySelector('.rank-name')?.innerText),record:clean(r.querySelector('.rank-record')?.innerText),winRate:clean(r.querySelector('.rank-pct')?.innerText)}));
 const currentRoot=$('currentTeams');
 const currentTeams=[...currentRoot?.querySelectorAll(':scope > .team')||[]].slice(0,2).map(team=>clean(team.innerText).split(/\s*\+\s*/).map(name=>({name:clean(name),skill:skillFor(name,map)})).filter(p=>p.name));
 const data={version:5,sessionCode:code,season:localStorage.getItem('crg-season-name')||'Court Rotation',current:{game:clean($('currentNo')?.innerText),court:clean($('currentCourt')?.innerText),teams:currentTeams,sitting:clean($('currentSit')?.innerText),status:clean($('liveStatus')?.innerText)},progress:{text:clean($('progressText')?.innerText),percent:clean($('progressPct')?.innerText)},schedule:rows,rankings,updatedAt:new Date().toISOString()};
 return `${location.origin}${location.pathname}?s=${btoa(unescape(encodeURIComponent(JSON.stringify(data))))}&view=spectator`;
}
async function copyFrozenSnapshot(){
 const legacy=$('snapshotLinkBtn');
 if(legacy?.onclick){try{return await legacy.onclick()}catch{}}
 const url=snapshotFallback();
 if(!url)return toast('Generate a rotation first.');
 try{await navigator.clipboard.writeText(url);toast('Frozen snapshot link copied')}catch{prompt('Copy this frozen snapshot link:',url)}
}
function cleanup(){
 const frozen=$('copyFrozenSnapshotBtn');
 const legacySnapshot=$('snapshotLinkBtn');
 if(frozen&&!frozen.dataset.wired){frozen.addEventListener('click',copyFrozenSnapshot);frozen.dataset.wired='1'}
 if(legacySnapshot)legacySnapshot.remove();
 $('shareDisplayBtn')?.remove();
 $('liveSyncBtn')?.remove();
 const share=$('shareSessionBtn');if(share)share.textContent='Share session schedule';
 let hint=$('sessionToolsHint');
 const stack=document.querySelector('#moreView .card .tool-stack');
 if(stack&&!hint){hint=document.createElement('p');hint.id='sessionToolsHint';hint.className='hint';stack.after(hint)}
 if(hint)hint.textContent='Live spectator link is in Live. Frozen snapshots work without a database connection.';
}
function boot(){cleanup();new MutationObserver(cleanup).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
