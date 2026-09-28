(()=>{'use strict';
const LEVELS=['Beginner','Advanced Beginner','Intermediate','Advanced Intermediate','Advanced','Expert'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=v=>String(v??'').trim(),normalizeSkill=v=>LEVELS.includes(clean(v))?clean(v):'Intermediate',starsForSkill=skill=>'⭐'.repeat(Math.max(1,LEVELS.indexOf(normalizeSkill(skill))+1));
const normalizePlayer=p=>typeof p==='object'&&p!==null?{name:clean(p.name),skill:normalizeSkill(p.skill)}:{name:clean(p),skill:'Intermediate'};
const cls=(a,b)=>[a,b||''].filter(Boolean).join(' ');
function renderPlayer(player,o={}){const p=normalizePlayer(player);if(!p.name)return'';const stars=starsForSkill(p.skill);return '<div class="crg-team-player"><span class="'+cls('crg-team-player-name live-player-name spectator-player-name',o.nameClass)+'">'+esc(p.name)+'</span><span class="'+cls('crg-team-player-stars live-player-stars spectator-player-stars',o.starsClass)+'"><small aria-label="'+esc(stars)+' skill stars">'+esc(stars)+'</small></span></div>'}
function renderTeam(team,o={}){const ps=(team||[]).slice(0,2).map(normalizePlayer).filter(p=>p.name),root=cls('crg-team-block',o.className);if(!ps.length)return'<div class="'+root+'"><span class="hint">—</span></div>';return'<div class="'+root+'">'+ps.map((p,i)=>renderPlayer(p,{nameClass:o.nameClass,starsClass:o.starsClass})+(i===0&&ps[1]?'<span class="crg-team-and live-and spectator-and">and</span>':'')).join('')+'</div>'}
function renderMatchup(teams,o={}){const variant=o.variant||'',side=variant==='spectator'?'crg-team-side spectator-team':'crg-team-side',vs=variant==='spectator'?'crg-team-vs spectator-vs':'crg-team-vs',sc=variant==='schedule'?'schedule-player-stars':'';return'<div class="'+cls('crg-team-matchup',o.className)+'">'+renderTeam(teams?.[0],{className:side,starsClass:sc})+'<div class="'+vs+'">vs</div>'+renderTeam(teams?.[1],{className:side,starsClass:sc})+'</div>'}
function teamText(team){return(team||[]).slice(0,2).map(normalizePlayer).filter(p=>p.name).map(p=>p.name+'\n'+starsForSkill(p.skill)).join('\nand\n')}
function matchupText(teams){return teamText(teams?.[0])+'\nvs\n'+teamText(teams?.[1])}
window.CRG_TEAM_RENDERER={levels:LEVELS,normalizePlayer,starsForSkill,renderPlayer,renderTeam,renderMatchup,teamText,matchupText};
})();