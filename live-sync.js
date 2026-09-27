(()=>{'use strict';

const CONFIG=window.CRG_SUPABASE_CONFIG||{};
const LIVE_STATE_KEY='crg-live-state-v1';

let client=null;
let channel=null;
let pollTimer=0;
let hostTimer=0;
let lastPublished='';

const $=id=>document.getElementById(id);
const clean=value=>String(value??'').trim();
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const titleCase=value=>clean(value).replace(/\s+/g,' ').replace(/(^|[\s'-])([a-zà-ÿ])/g,(_,prefix,char)=>prefix+char.toLocaleUpperCase());

function readLiveState(){
  try{
    const raw=localStorage.getItem(LIVE_STATE_KEY);
    if(!raw)return null;
    const data=JSON.parse(raw);
    if(!data||!Array.isArray(data.names)||!Array.isArray(data.games)||!data.games.length)return null;
    return data;
  }catch(error){
    console.warn('CRG live sync state read failed:',error);
    return null;
  }
}

function sessionCode(){
  return clean(readLiveState()?.sessionCode);
}

function playerName(data,id){
  return clean(data?.names?.[Number(id)-1]||'Player '+id);
}

function storedSkills(){
  try{return JSON.parse(localStorage.getItem('crg-skills-v1')||'{}')||{}}
  catch{return{}}
}

function skillForName(name){
  const skills=storedSkills();
  return titleCase(skills[titleCase(name)]||'Intermediate');
}

function skillStars(skill){
  const levels=['Beginner','Advanced Beginner','Intermediate','Advanced Intermediate','Advanced','Expert'];
  const index=levels.indexOf(String(skill));
  return '⭐'.repeat(Math.max(1,index+1));
}

function elapsedSeconds(data,index){
  const recorded=Number(data?.gameDurations?.[index]);
  if(Number.isFinite(recorded))return Math.max(0,Math.floor(recorded));
  const currentIndex=liveIndex(data);
  const started=Number(data?.gameStartedAt);
  if(index!==currentIndex||!Number.isFinite(started))return 0;
  return Math.max(0,Math.floor((Date.now()-started)/1000));
}

function liveIndex(data){
  const done=new Set(Array.isArray(data?.done)?data.done.map(Number):[]);
  const index=(data.games||[]).findIndex((_,i)=>!done.has(i));
  return index<0?(data.games||[]).length:index;
}

function formatElapsed(totalSeconds){
  const total=Math.max(0,Math.floor(Number(totalSeconds)||0));
  const mm=Math.floor(total/60).toString().padStart(2,'0');
  const ss=(total%60).toString().padStart(2,'0');
  return mm+':'+ss;
}

function teamData(data,team){
  return (Array.isArray(team)?team:[]).map(id=>{
    const name=playerName(data,id);
    const skill=skillForName(name);
    return {name,skill};
  });
}

function rankingData(data){
  const names=data?.names||[];
  const games=data?.games||[];
  const results=data?.results&&typeof data.results==='object'?data.results:{};
  const stats=new Map(names.map((name,index)=>[index+1,{id:index+1,name,wins:0,losses:0,games:0}]));
  Object.keys(results).forEach(rawIndex=>{
    const index=Number(rawIndex);
    const game=games[index];
    const result=Number(results[rawIndex]);
    if(!game||!(result===0||result===1))return;
    const sides=game.teams||[];
    if(sides.length<2)return;
    sides.forEach((team,teamIndex)=>{
      (team||[]).forEach(id=>{
        const row=stats.get(Number(id));
        if(!row)return;
        row.games++;
        if(teamIndex===result)row.wins++;
        else row.losses++;
      });
    });
  });
  return [...stats.values()]
    .sort((a,b)=>b.wins-a.wins || (b.games?b.wins/b.games:0)-(a.games?a.wins/a.games:0) || a.name.localeCompare(b.name))
    .map((row,index)=>({
      position:index+1===1?'🏆🥇 1st':index+1===2?'🥈 2nd':index+1===3?'🥉 3rd':String(index+1),
      name:row.name,
      wins:row.wins,
      losses:row.losses,
      games:row.games,
      winRate:row.games?Math.round(row.wins/row.games*100)+'%':'—'
    }));
}

function buildPayload(){
  const data=readLiveState();
  if(!data)return null;
  const currentIndex=liveIndex(data);
  const done=new Set(Array.isArray(data.done)?data.done.map(Number):[]);
  const games=(data.games||[]).map((game,index)=>{
    const teams=game?.teams||[];
    return {
      index:index+1,
      teams:[teamData(data,teams[0]),teamData(data,teams[1])],
      court:String(game?.court||1),
      status:done.has(index)
        ? (Number(data.results?.[index])===0?'TEAM A WON':Number(data.results?.[index])===1?'TEAM B WON':'Completed')
        : index===currentIndex?'NEXT UP':'Upcoming',
      done:done.has(index),
      locked:Array.isArray(data.locked)&&data.locked.includes(index)
    };
  });
  const current=games[currentIndex];
  const totalGames=games.length;
  const completed=Math.min(totalGames,done.size);
  const currentTimer=current&&currentIndex<totalGames?formatElapsed(elapsedSeconds(data,currentIndex)):'00:00';
  return {
    version:7,
    sessionCode:clean(data.sessionCode),
    season:localStorage.getItem('crg-season-name')||'Court Rotation',
    current:current?{
      game:'GAME '+current.index,
      court:'COURT '+current.court,
      teams:current.teams,
      sitting:'Sitting out: '+clean(data.games?.[currentIndex]?.sitting?.map?.(id=>playerName(data,id)).join(', ')||'None'),
      status:completed>=totalGames?'COMPLETE':'NEXT UP',
      timer:currentTimer
    }:{
      game:'Waiting',
      court:'COURT —',
      teams:[[],[]],
      sitting:'',
      status:completed>=totalGames?'COMPLETE':'READY',
      timer:'00:00'
    },
    progress:{
      text:completed+' / '+totalGames+' games',
      percent:totalGames?Math.round(completed/totalGames*100)+'%':'0%'
    },
    schedule:games,
    rankings:rankingData(data),
    updatedAt:new Date().toISOString()
  };
}

async function loadSupabase(){
  if(client)return client;
  const key=clean(CONFIG.publishableKey);
  if(!clean(CONFIG.url)||!key)return null;
  try{
    if(!window.supabase?.createClient){
      await new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        script.onload=resolve;
        script.onerror=reject;
        document.head.appendChild(script);
      });
    }
    if(!window.supabase?.createClient)return null;
    client=window.supabase.createClient(CONFIG.url,key);
    return client;
  }catch(error){
    console.warn('CRG live sync load failed:',error);
    return null;
  }
}

async function publish(){
  const payload=buildPayload();
  if(!payload?.sessionCode)return false;
  const supabase=await loadSupabase();
  if(!supabase)return false;
  const raw=JSON.stringify(payload);
  if(raw===lastPublished)return true;
  const {error}=await supabase
    .from('court_rotation_sessions')
    .upsert({
      session_code:payload.sessionCode,
      payload,
      updated_at:payload.updatedAt
    },{onConflict:'session_code'});
  if(error){
    console.warn('CRG live sync publish failed:',error);
    return false;
  }
  lastPublished=raw;
  return true;
}

function hostTick(){
  if(sessionCode())publish().catch(error=>console.warn('CRG live sync publish failed:',error));
}

async function startHost(){
  const code=sessionCode();
  if(!code){
    toast('Generate a rotation first.');
    return;
  }
  if(!clean(CONFIG.publishableKey)){
    toast('Live spectator sync is not configured.');
    return;
  }
  if(!await publish()){
    toast('Could not start live spectator sync. Check the connection.');
    return;
  }
  const share=location.origin+location.pathname+'?live='+encodeURIComponent(code)+'&view=spectator';
  try{
    await navigator.clipboard.writeText(share);
    toast('Live spectator link copied');
  }catch{
    prompt('Copy this live spectator link:',share);
  }
}

function toast(message){
  let node=$('crgToast');
  if(!node){
    node=document.createElement('div');
    node.id='crgToast';
    document.body.appendChild(node);
  }
  node.textContent=message;
  node.classList.add('show');
  clearTimeout(node._timer);
  node._timer=setTimeout(()=>node.classList.remove('show'),2200);
}

function encodeSnapshot(data){
  const bytes=new TextEncoder().encode(JSON.stringify(data));
  let binary='';
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function decodeSnapshot(value){
  const normalized=clean(value).replace(/ /g,'+').replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(clean(value).length/4)*4,'=');
  const binary=atob(normalized);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary,char=>char.charCodeAt(0))));
}

async function fetchLive(code){
  const supabase=await loadSupabase();
  if(!supabase)return null;
  const {data,error}=await supabase
    .from('court_rotation_sessions')
    .select('payload')
    .eq('session_code',code)
    .maybeSingle();
  if(error){
    console.warn('CRG live spectator fetch failed:',error);
    return null;
  }
  return data?.payload||null;
}

function playerMarkup(player){
  const name=clean(player?.name||player);
  if(!name)return '';
  const skill=titleCase(player?.skill||'Intermediate');
  return '<span class="spectator-player"><span class="spectator-player-name">'+escapeHtml(name)+'</span><small>'+escapeHtml(skillStars(skill))+'</small></span>';
}

function matchupMarkup(teams){
  const a=Array.isArray(teams?.[0])?teams[0]:[];
  const b=Array.isArray(teams?.[1])?teams[1]:[];
  return '<div class="spectator-matchup"><div class="spectator-team"><div class="spectator-team-label">TEAM A</div><div class="spectator-team-players">'+(a.map(playerMarkup).join('<span class="spectator-plus" aria-hidden="true">+</span>')||'<span class="hint">—</span>')+'</div></div><div class="spectator-vs">VS</div><div class="spectator-team"><div class="spectator-team-label">TEAM B</div><div class="spectator-team-players">'+(b.map(playerMarkup).join('<span class="spectator-plus" aria-hidden="true">+</span>')||'<span class="hint">—</span>')+'</div></div></div>';
}

function leaderboardRows(ranks){
  const list=Array.isArray(ranks)?ranks:[];
  const hasResults=list.some(row=>(Number(row?.games)||0)>0);
  if(!hasResults)return '<p class="hint">No results yet. Complete games and record a winner to build the standings.</p>';
  return '<div class="rankings-list">'+list.map(row=>'<article class="rank-row"><div class="rank-identity"><div class="rank-pos">'+escapeHtml(row.position||'—')+'</div><div class="rank-name">'+escapeHtml(row.name||'')+'</div></div><div class="rank-stats"><span class="rank-chip">'+(Number(row.wins)||0)+'W</span><span class="rank-chip">'+(Number(row.losses)||0)+'L</span><span class="rank-chip">'+(Number(row.games)||0)+' '+((Number(row.games)||0)===1?'game':'games')+'</span><span class="rank-chip rank-pct">'+escapeHtml(row.winRate||'—')+'</span></div></article>').join('')+'</div>';
}

function renderSnapshot(payload){
  document.body.classList.add('spectator-mode');
  const app=document.querySelector('.app');
  if(!app)return;
  const current=payload?.current||{};
  const progress=payload?.progress||{};
  const games=Array.isArray(payload?.schedule)?payload.schedule:[];
  app.innerHTML='<main class="spectator-page"><div class="card spectator-shell"><span class="eyebrow">LIVE COURT DISPLAY · '+escapeHtml(payload?.sessionCode||'')+'</span><h1>'+escapeHtml(payload?.season||'Court Rotation')+'</h1><div class="card spectator-current"><div class="eyebrow">NOW · '+escapeHtml(current.court||'COURT —')+'</div><h2>'+escapeHtml(current.game||'Waiting')+'</h2>'+matchupMarkup(current.teams||[])+'<p class="hint spectator-sitting">'+escapeHtml(current.sitting||'')+'</p><div class="spectator-live-meta"><span>'+escapeHtml(current.status||'READY')+'</span><strong>'+escapeHtml(current.timer||'00:00')+'</strong></div><div class="progress spectator-progress"><div><span>'+escapeHtml(progress.text||'')+'</span><b>'+escapeHtml(progress.percent||'0%')+'</b></div><div class="progress-bar"><span style="width:'+escapeHtml(progress.percent||'0%')+'"></span></div></div></div><div class="spectator-schedule">'+games.map(game=>'<article class="card spectator-game"><div class="eyebrow">GAME '+escapeHtml(game.index)+' · COURT '+escapeHtml(game.court)+'</div>'+matchupMarkup(game.teams||[])+'<p class="hint">'+escapeHtml(game.status||'Upcoming')+'</p></article>').join('')+'</div><div class="card spectator-leaderboard"><div class="card-head"><h2>Live leaderboard</h2><span class="badge">LIVE</span></div>'+leaderboardRows(payload.rankings||[])+'</div><p class="hint spectator-updated">Updated '+escapeHtml(new Date(payload.updatedAt||Date.now()).toLocaleTimeString())+'</p></div></main>';
}

function renderLiveLeaderboard(payload){
  document.body.classList.add('spectator-mode');
  const app=document.querySelector('.app');
  if(!app)return;
  app.innerHTML='<main class="spectator-page shared-live-leaderboard-page"><div class="card spectator-shell"><span class="eyebrow">LIVE LEADERBOARD · '+escapeHtml(payload?.sessionCode||'')+'</span><h1>'+escapeHtml(payload?.season||'Court Rotation')+'</h1><p class="hint">Live · updates automatically</p><div class="card spectator-leaderboard">'+leaderboardRows(payload?.rankings||[])+'</div><p class="hint spectator-updated">Updated '+escapeHtml(new Date(payload?.updatedAt||Date.now()).toLocaleTimeString())+'</p></div></main>';
}

function renderError(message){
  document.body.classList.add('spectator-mode');
  const app=document.querySelector('.app');
  if(app)app.innerHTML='<main class="spectator-page"><div class="card"><span class="eyebrow">LIVE COURT DISPLAY</span><h1>Live spectator</h1><p class="hint">'+escapeHtml(message)+'</p></div></main>';
}

function stopViewer(){
  if(pollTimer){
    clearInterval(pollTimer);
    pollTimer=0;
  }
  if(channel){
    try{channel.unsubscribe()}catch{}
    channel=null;
  }
}

async function startViewer(code,mode){
  stopViewer();
  const first=await fetchLive(code);
  if(!first){
    renderError('Live session not found yet. Ask the host to start live spectator sharing.');
    return;
  }
  if(mode==='leaderboard')renderLiveLeaderboard(first);
  else renderSnapshot(first);
  const supabase=await loadSupabase();
  if(supabase){
    channel=supabase
      .channel('crg-session-'+code)
      .on('postgres_changes',{
        event:'*',
        schema:'public',
        table:'court_rotation_sessions',
        filter:'session_code=eq.'+code
      },event=>{
        if(event?.new?.payload){
          if(mode==='leaderboard')renderLiveLeaderboard(event.new.payload);
          else renderSnapshot(event.new.payload);
        }
      })
      .subscribe();
  }
  pollTimer=setInterval(async()=>{
    const next=await fetchLive(code);
    if(!next)return;
    if(mode==='leaderboard')renderLiveLeaderboard(next);
    else renderSnapshot(next);
  },2500);
}

function installHost(){
  if(!hostTimer){
    hostTimer=setInterval(hostTick,1200);
  }
  hostTick();
}

window.CRG_COPY_LIVE_SPECTATOR_LINK=startHost;window.CRG_PUBLISH_LIVE_SESSION=publish;
document.addEventListener('click',event=>{
  const button=event.target?.closest?.('#copyLiveSpectatorBtn');
  if(!button)return;
  event.preventDefault();
  startHost().catch(error=>console.warn('CRG live spectator start failed:',error));
},{capture:true});

async function boot(){
  const params=new URLSearchParams(location.search);
  const mode=params.get('view');
  const live=params.get('live');
  const encoded=(params.get('s')||'').replace(/ /g,'+');
  if(mode==='spectator'||mode==='leaderboard'){
    if(live){
      await startViewer(live,mode);
      return;
    }
    if(encoded){
      try{
        const payload=decodeSnapshot(encoded);
        if(mode==='leaderboard')renderLiveLeaderboard(payload);
        else renderSnapshot(payload);
        return;
      }catch(error){
        console.warn('CRG snapshot decode failed:',error);
      }
    }
    renderError('This live link is missing its session data.');
    return;
  }
  installHost();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();

})();