(function(){'use strict';
function seeded(seed){let x=seed>>>0;return function(){x+=0x6D2B79F5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
function shuffle(a,r){a=a.slice();for(let i=a.length-1;i>0;i--){let j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function quad(a){return a.slice().sort((x,y)=>x-y).join('-')}
function combos(a,limit=120){const out=[];outer:for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)for(let k=j+1;k<a.length;k++)for(let l=k+1;l<a.length;l++){out.push([a[i],a[j],a[k],a[l]]);if(out.length>=limit)break outer}return out}
const skillValue=v=>{if(typeof v==='number')return Math.max(1,Math.min(5,v));const s=String(v||'').toLowerCase();if(s==='beginner')return 1;if(s==='advanced')return 5;if(s==='intermediate')return 3;const n=Number(s);return Number.isFinite(n)?Math.max(1,Math.min(5,n)):3};
// A pair counts as "both beginners" only when each player's resolved skill value is exactly 1 (Beginner).
const bothBeginners=(sa,sb)=>sa===1&&sb===1;
function score(games,players,skills){const skillMap=skills instanceof Map?skills:new Map(Object.entries(skills||{})),skillScores=new Map(players.map(p=>[p,skillValue(skillMap.get(p))]));let partner=new Map(players.map(p=>[p,new Set()])),opp=new Map(players.map(p=>[p,new Map()])),sits=new Map(players.map(p=>[p,0])),last=new Map(players.map(p=>[p,0])),quads=new Map(),rp=0,ro=0,rq=0,skillPenalty=0,beginnerPairs=0;games.forEach(g=>{let on=g.teams.flat(),q=quad(on);quads.set(q,(quads.get(q)||0)+1);on.forEach(p=>last.set(p,0));g.sitting.forEach(p=>{if(last.get(p))sits.set(p,sits.get(p)+1);last.set(p,last.get(p)+1)});g.teams.forEach(([a,b])=>{if(partner.get(a).has(b))rp++;partner.get(a).add(b);partner.get(b).add(a);const sa=skillScores.get(a)||3,sb=skillScores.get(b)||3;skillPenalty+=Math.abs(sa-sb);if(bothBeginners(sa,sb))beginnerPairs++});let[a,b]=g.teams;for(let x of a)for(let y of b){if(opp.get(x).has(y))ro++;opp.get(x).set(y,(opp.get(x).get(y)||0)+1);opp.get(y).set(x,(opp.get(y).get(x)||0)+1)}});quads.forEach(v=>{if(v>1)rq+=v-1});let sv=[...sits.values()],spread=sv.length?Math.max(...sv)-Math.min(...sv):0;return Math.max(0,Math.min(100,Math.round(100-rp*35-ro*5-rq*18-spread*12-skillPenalty*2-beginnerPairs*40)))}
function fastFallback(players,total,targets,fixed,courts,rest,skillScore,seed){let r=seeded(seed>>>0),plays=new Map(players.map(p=>[p,0])),partners=new Map(players.map(p=>[p,new Set()])),opps=new Map(players.map(p=>[p,new Map()])),last=new Map(players.map(p=>[p,0])),games=new Array(total);
const add=g=>{const on=g.teams.flat(),u=new Set(on);g.sitting=players.filter(p=>!u.has(p));g.teams.forEach(([a,b])=>{partners.get(a).add(b);partners.get(b).add(a);plays.set(a,plays.get(a)+1);plays.set(b,plays.get(b)+1)});const[a1,a2]=g.teams[0],[b1,b2]=g.teams[1];[[a1,b1],[a1,b2],[a2,b1],[a2,b2]].forEach(([a,b])=>{opps.get(a).set(b,(opps.get(a).get(b)||0)+1);opps.get(b).set(a,(opps.get(b).get(a)||0)+1)});last.forEach((_,p)=>last.set(p,u.has(p)?0:(last.get(p)||0)+1))};
for(let i=0;i<total;i++){const fx=fixed.get(i);if(fx){const g={teams:fx.teams.map(t=>t.slice()),court:fx.court||((i%courts)+1),sitting:(fx.sitting||[]).slice()};add(g);games[i]=g;continue}
const candidates=shuffle(players,r).sort((a,b)=>{const da=plays.get(a)-(targets.get(a)||0),db=plays.get(b)-(targets.get(b)||0);if(da!==db)return da-db;const lr=(last.get(b)||0)-(last.get(a)||0);return lr||plays.get(a)-plays.get(b)});
const chosen=[];for(const p of candidates){if((targets.get(p)||0)>plays.get(p)){chosen.push(p);if(chosen.length===4)break}}
if(chosen.length<4)for(const p of candidates){if(!chosen.includes(p)){chosen.push(p);if(chosen.length===4)break}}
const splits=[[[chosen[0],chosen[1]],[chosen[2],chosen[3]]],[[chosen[0],chosen[2]],[chosen[1],chosen[3]]],[[chosen[0],chosen[3]],[chosen[1],chosen[2]]]];let best=splits[0],bestCost=Infinity;for(const[t1,t2]of splits){const sk1a=skillScore.get(t1[0])||3,sk1b=skillScore.get(t1[1])||3,sk2a=skillScore.get(t2[0])||3,sk2b=skillScore.get(t2[1])||3;const s1=Math.abs(sk1a-sk1b),s2=Math.abs(sk2a-sk2b),tg=Math.abs((sk1a+sk1b)-(sk2a+sk2b));let cost=s1*7+s2*7+tg*3+(partners.get(t1[0]).has(t1[1])||partners.get(t2[0]).has(t2[1])?40:0);
// Hard-discourage two beginners ending up on the same team; prefer beginner+intermediate or beginner+advanced instead.
if(bothBeginners(sk1a,sk1b))cost+=300;if(bothBeginners(sk2a,sk2b))cost+=300;
for(const x of t1)for(const y of t2)cost+=(opps.get(x).get(y)||0)*8;if(rest==='avoid-consecutive'&&chosen.some(p=>(last.get(p)||0)>0))cost-=2;if(cost<bestCost){bestCost=cost;best=[t1.slice(),t2.slice()]}}
const g={teams:best,court:(i%courts)+1};add(g);games[i]=g}
return games}
function generate(cfg){let players=cfg.players.slice(),fixed=cfg.fixed||new Map(),requestedPer=Math.max(1,Number(cfg.per)||1),total=Number.isInteger(cfg.totalGames)?cfg.totalGames:Math.max(1,Math.floor(players.length*requestedPer/4)),targets=new Map(cfg.targets instanceof Map?cfg.targets:players.map(p=>[p,requestedPer]));
if(fixed.size){for(const g of fixed.values())for(const p of g.teams.flat())targets.set(p,(targets.get(p)||0)+1)}
if(players.length<4||total<1)return null;let participant=[...new Set([...players,...[...fixed.values()].flatMap(g=>g.teams.flat())])];
const courts=Math.max(1,Number(cfg.courts)||1),skills=cfg.skills instanceof Map?cfg.skills:new Map(Object.entries(cfg.skills||window.CRG_PLAYER_SKILLS||{})),skillScore=new Map(participant.map(p=>[p,skillValue(skills.get(p))]));
// Guaranteed fast baseline: large rosters return a complete skill-aware schedule without entering the expensive optimizer.
const fallback=fastFallback(players,total,targets,fixed,courts,cfg.rest,skillScore,cfg.seed||0);if(players.length>=20)return{games:fallback,score:score(fallback,players,skills)};
const attempts=Math.max(1,Math.min(120,Number(cfg.attempts)||60)),maxEligible=Math.min(16,players.length),maxChoices=120;
const budgetMs=Math.max(250,Math.min(1800,Number(cfg.timeBudgetMs)||1200)),deadline=(typeof performance!=='undefined'&&performance.now?performance.now():Date.now())+budgetMs;
const timedOut=()=>((typeof performance!=='undefined'&&performance.now?performance.now():Date.now())>=deadline);
const skillOf=p=>skillScore.get(p)||3;let best={games:fallback,score:score(fallback,players,skills)};
// Hard outer-loop guard: this counter is independent of the clock and is checked before any attempt work.
let hardIterationCount=0,hardWorkCount=0;const maxHardWork=10000;
for(let attempt=0;attempt<attempts;attempt++){if(++hardIterationCount>attempts||timedOut())break;let r=seeded(((cfg.seed||0)+attempt*7919)>>>0),plays=new Map(participant.map(p=>[p,0])),partners=new Map(participant.map(p=>[p,new Set()])),opps=new Map(participant.map(p=>[p,new Map()])),last=new Map(players.map(p=>[p,0])),quads=new Map(),games=new Array(total),ok=true;
function add(g){let on=g.teams.flat(),u=new Set(on);if(on.length!==4||u.size!==4||on.some(p=>!plays.has(p)))return false;for(const[t1,t2]of g.teams){let ta=targets.get(t1)||0,tb=targets.get(t2)||0;if(partners.get(t1).has(t2)||plays.get(t1)>=ta||plays.get(t2)>=tb)return false}let q=quad(on);if((quads.get(q)||0)>=2)return false;g.sitting=players.filter(p=>!u.has(p));g.teams.forEach(([a,b])=>{partners.get(a).add(b);partners.get(b).add(a);plays.set(a,plays.get(a)+1);plays.set(b,plays.get(b)+1)});let[a1,a2]=g.teams[0],[b1,b2]=g.teams[1];[[a1,b1],[a1,b2],[a2,b1],[a2,b2]].forEach(([a,b])=>{opps.get(a).set(b,(opps.get(a).get(b)||0)+1);opps.get(b).set(a,(opps.get(b).get(a)||0)+1)});quads.set(q,(quads.get(q)||0)+1);players.forEach(p=>last.set(p,u.has(p)?0:(last.get(p)||0)+1));return true}
for(let i=0;i<total;i++){if(++hardIterationCount>attempts||timedOut()){ok=false;break}let fx=fixed.get(i);if(fx){let copy={teams:fx.teams.map(t=>t.slice()),sitting:fx.sitting.slice(),court:fx.court||((i%courts)+1)};if(!add(copy)){ok=false;break}games[i]=copy;continue}let eligible=shuffle(players.filter(p=>plays.get(p)<(targets.get(p)||0)),r).sort((a,b)=>((plays.get(a)-plays.get(b))*5)+((last.get(a)||0)-(last.get(b)||0))*2+(r()-.5));let choices=shuffle(combos(eligible.slice(0,Math.min(maxEligible,eligible.length)),maxChoices),r),chosen=null,localBest=-Infinity;for(let four of choices){if(++hardWorkCount>maxHardWork||timedOut()){ok=false;break}let q=quad(four),splits=shuffle([[[four[0],four[1]],[four[2],four[3]]],[[four[0],four[2]],[four[1],four[3]]],[[four[0],four[3]],[four[1],four[2]]]],r);for(let[t1,t2]of splits){if(++hardWorkCount>maxHardWork||timedOut()){ok=false;break}if(partners.get(t1[0]).has(t1[1])||partners.get(t2[0]).has(t2[1]))continue;let local=(quads.get(q)||0)*-50;four.forEach(p=>{local-=plays.get(p)*6;if(last.get(p)>0)local+=cfg.rest==='avoid-consecutive'?12:3});for(let x of t1)for(let y of t2)if(opps.get(x).has(y))local-=16*(opps.get(x).get(y)||1);
// FIX: skill gaps must be computed from each team's actual two members (t1/t2), not fixed positions in `four`.
// Previously this always read four[0]/four[1] regardless of which split was being scored, so skill-awareness
// had no real effect on which split got chosen.
const s1a=skillOf(t1[0]),s1b=skillOf(t1[1]),s2a=skillOf(t2[0]),s2b=skillOf(t2[1]);
const gap1=Math.abs(s1a-s1b),gap2=Math.abs(s2a-s2b),teamGap=Math.abs((s1a+s1b)-(s2a+s2b));
local-=gap1*7+gap2*7+teamGap*3;
// Hard-discourage two beginners on the same team; only reward a zero skill-gap pairing when it isn't beginner+beginner.
const t1Beginner=bothBeginners(s1a,s1b),t2Beginner=bothBeginners(s2a,s2b);
if(t1Beginner)local-=300;else if(gap1===0)local+=3;
if(t2Beginner)local-=300;else if(gap2===0)local+=3;
if(local>localBest){localBest=local;chosen={teams:[t1.slice(),t2.slice()]}}}}
if(!ok)break;if(!chosen||!add(chosen)){ok=false;break}chosen.court=(i%courts)+1;games[i]=chosen}if(!ok)continue;if(timedOut())break;let sc=score(games,players,skills);if(!best||sc>best.score)best={games,score:sc};if(sc>=98)break}
return best}
window.RotationScheduler={generate,skillValue};})();
