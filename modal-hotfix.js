(()=>{'use strict';
const $=id=>document.getElementById(id);
function close(){const sheet=$('sheet');if(sheet)sheet.hidden=true}
function init(){
  const sheet=$('sheet');
  const closeBtn=$('sheetClose');
  const backdrop=$('sheetBackdrop');
  if(closeBtn) closeBtn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();close()},true);
  if(backdrop) backdrop.addEventListener('click',e=>{if(e.target===backdrop)close()},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && sheet && !sheet.hidden)close()},true);
  if(sheet) sheet.hidden=true;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();