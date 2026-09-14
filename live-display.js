(()=>{'use strict';
const teams=document.getElementById('currentTeams'),names=document.getElementById('names');
if(!teams||!names)return;
const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const clean=v=>String(v||'').trim();
const roster=()=>names.value.split(/\r?\n/).map(clean).filter(Boolean);
function storedSkills(){try{return JSON.parse(localStorage.getItem('crg-skills-v1')||'{}')||{}}catch{return{}}}
function skillByName(){const list=roster(),src=window.CRG_PLAYER_SKILLS||{},stored=storedSkills(),out=new Map();list.forEach((name,i)=>out.set(name.toLocaleLowerCase(),src[i+1]||stored[name]||'Intermediate'));return out}
function formatPlayer(name,map){const key=clean(name).toLocaleLowerCase(),skill=map.get(key)||'Intermediate';return `<span class="live-player"><strong>${esc(name)}</strong><small>${esc(skill)}</small></span>`}
function render(){
  if(teams.querySelector('.live-player'))return;
  const raw=teams.textContent.replace(/\s+/g,' ').trim();
  if(!raw||raw==='—')return;
  const parts=raw.split(/\s+VS\s+/i);
  if(parts.length!==2)return;
  const teamA=parts[0].split(/\s+\+\s+/).map(clean).filter(Boolean),teamB=parts[1].split(/\s+\+\s+/).map(clean).filter(Boolean);
  if(teamA.length<2||teamB.length<2)return;
  const map=skillByName();
  teams.innerHTML=`<div class="team"><div class="live-team-players">${teamA.map(n=>formatPlayer(n,map)).join('')}</div></div><div class="versus">VS</div><div class="team"><div class="live-team-players">${teamB.map(n=>formatPlayer(n,map)).join('')}</div></div>`;
}
new MutationObserver(()=>{if(!teams.querySelector('.live-player'))render()}).observe(teams,{childList:true,subtree:true,characterData:true});
render();
})();
