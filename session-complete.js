(()=>{'use strict';
const $=id=>document.getElementById(id);
let shown=false;
function close(){const s=$('sheet');if(s){s.hidden=true;document.body.classList.remove('modal-open')}}
function ordinal(n){const j=n%10,k=n%100;return j===1&&k!==11?'st':j===2&&k!==12?'nd':j===3&&k!==13?'rd':'th'}
function openFinalRankings(){
  const sheet=$('sheet'),content=$('sheetContent'),list=$('rankingsList');
  if(!sheet||!content||!list)return;
  const rows=[...list.querySelectorAll('.rank-row')];
  if(!rows.length)return;
  const ranking=rows.map((row,i)=>{
    const name=row.querySelector('.rank-name')?.textContent?.trim()||`Player ${i+1}`;
    const record=row.querySelector('.rank-record')?.textContent?.replace(/\s+/g,' ').trim()||'';
    const pct=row.querySelector('.rank-pct')?.textContent?.replace(/\s+/g,' ').trim()||'';
    return {name,record,pct};
  });
  const top=ranking.slice(0,5),rest=ranking.slice(5);
  const make=(p,i,topFive=false)=>`<div class="complete-rank-row ${topFive?'top-five':'rest-rank'}"><div class="complete-place">${i+1}${ordinal(i+1)}</div><div class="complete-name">${escapeHtml(p.name)}</div><div class="complete-record">${escapeHtml(p.record)}</div><div class="complete-pct">${escapeHtml(pctText(p.pct))}</div></div>`;
  const html=`<div class="sheet-title">Session complete</div><p class="hint">Final rankings</p><div class="completion-rankings-wrap"><div class="complete-rankings">${top.map((p,i)=>make(p,i,true)).join('')}${rest.map((p,i)=>make(p,i+5,false)).join('')}</div></div><button type="button" class="btn full complete-close" id="completeCloseBtn">Close rankings</button>`;
  content.innerHTML=html;
  sheet.hidden=false;
  const closeBtn=$('completeCloseBtn');
  if(closeBtn)closeBtn.addEventListener('click',close,{once:true});
}
function pctText(v){return v?`${v.split(' ')[0]}`:''}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function watch(){
  const current=$('currentNo');
  if(!current)return;
  const check=()=>{
    const complete=/SESSION COMPLETE/i.test(current.textContent||'');
    if(!complete){shown=false;return}
    if(!shown){shown=true;setTimeout(openFinalRankings,0)}
  };
  new MutationObserver(check).observe(current,{childList:true,characterData:true,subtree:true});
  check();
}
function init(){
  const sheet=$('sheet');
  if(sheet)sheet.addEventListener('click',e=>{if(e.target===$('sheetBackdrop'))close()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watch,{once:true});else watch();
}
init();
})();
