(()=>{'use strict';
const $=id=>document.getElementById(id);
function injectPolishStyles(){if(document.getElementById('uiPolishStyles'))return;const s=document.createElement('style');s.id='uiPolishStyles';s.textContent='.spectator-mode .spectator-current + div + .card{margin-top:var(--section-gap,16px)}.spectator-mode .spectator-current + div{margin-bottom:0!important}';document.head.appendChild(s)}
function escapeHtml(v){return String(v).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]))}
function fixSchedule(){document.querySelectorAll('.game-match').forEach(el=>{if(el.dataset.polished==='true')return;const text=(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();if(!text)return;const parts=text.split(/\s+VS\s+/i);if(parts.length!==2)return;const [a,b]=parts;el.innerHTML=`<span class="schedule-team-label">TEAM A</span><span class="schedule-team-players">${escapeHtml(a.replace(/\s*TEAM A\s*/i,'').trim())}</span><span class="schedule-vs">VS</span><span class="schedule-team-label">TEAM B</span><span class="schedule-team-players">${escapeHtml(b.replace(/\s*TEAM B\s*/i,'').trim())}</span>`;el.dataset.polished='true'})}
function boot(){injectPolishStyles();fixSchedule();
const container=document.querySelector('#scheduleList')||document.querySelector('.schedule-list')||document.querySelector('#schedule');
if(!container)return;
// Safe observer: scoped to the schedule container and guarded by a stable polished flag.
const obs=new MutationObserver(()=>{fixSchedule()});
obs.observe(container,{subtree:true,childList:true,characterData:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();