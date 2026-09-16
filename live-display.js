(()=>{'use strict';const teams=document.getElementById('currentTeams'),names=document.getElementById('names');
if(!teams||!names)return;
const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const clean=v=>String(v||'').trim();
const roster=()=>names.value.split(/\r?\n/).map(clean).filter(Boolean);
function storedSkills(){try{return JSON.parse(localStorage.getItem('crg-skills-v1')||'{}')||{}}catch{return{}}}
function skillByName(){const list=roster(),src=window.CRG_PLAYER_SKILLS||{},stored=storedSkills(),out=new Map();list.forEach((name,i)=>out.set(name.toLocaleLowerCase(),String(src[i+1]||stored[name]||'Intermediate').toLocaleLowerCase()));return out}
function formatTeam(playerNames,map){const namesHtml=playerNames.map(n=>esc(n)).join(' + ');const skillsHtml=playerNames.map(n=>esc(map.get(clean(n).toLocaleLowerCase())||'intermediate')).join(' ');return `<div class="live-team-block"><div class="live-team-name">${namesHtml}</div><div class="live-team-skills">${skillsHtml}</div></div>`}
function render(){
  if(teams.dataset.liveGameText==='')teams.dataset.liveGameText='';
  const raw=teams.textContent.replace(/\s+/g,' ').trim();
  if(!raw||raw==='—')return;
  const parts=raw.split(/\s+VS\s+/i);
  if(parts.length!==2)return;
  const teamA=parts[0].split(/\s+\+\s+/).map(clean).filter(Boolean),teamB=parts[1].split(/\s+\+\s+/).map(clean).filter(Boolean);
  if(teamA.length<2||teamB.length<2)return;
  const map=skillByName();
  teams.innerHTML=`<div class="team">${formatTeam(teamA,map)}</div><div class="versus">VS</div><div class="team">${formatTeam(teamB,map)}</div>`;
}
let lastPlain='';
// Safe observer: only rewrites unformatted team markup and converges after one pass via lastPlain + live-team-block.
new MutationObserver(()=>{const hasRendered=!!teams.querySelector('.live-team-block');const text=teams.textContent.replace(/\s+/g,' ').trim();if(hasRendered&&!/\sVS\s/i.test(text))return;if(text!==lastPlain){lastPlain=text;render()}}).observe(teams,{childList:true,subtree:true,characterData:true});
render();
})();