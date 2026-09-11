(()=>{'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
let allowReset=false,allowRestart=false;
let nativeConfirm=window.confirm.bind(window);
let suppressNativeConfirm=false;
window.confirm=message=>suppressNativeConfirm?true:nativeConfirm(message);
function openConfirm(title,message,actionLabel,action){
  const sheet=$('sheet'),content=$('sheetContent');
  if(!sheet||!content)return;
  content.innerHTML=`<div class="sheet-title">${esc(title)}</div><p class="hint">${esc(message)}</p><div class="confirm-actions"><button type="button" class="btn modal-cancel" id="modalCancel">Cancel</button><button type="button" class="btn modal-confirm" id="modalConfirm">${esc(actionLabel)}</button></div>`;
  sheet.hidden=false;sheet.classList.add('modal-open');document.body.classList.add('modal-open');
  $('modalCancel')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();sheet.hidden=true;sheet.classList.remove('modal-open');document.body.classList.remove('modal-open')},{once:true});
  $('modalConfirm')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();sheet.hidden=true;sheet.classList.remove('modal-open');document.body.classList.remove('modal-open');action()},{once:true});
}
function runOriginal(button,flagSetter){
  flagSetter(true);
  suppressNativeConfirm=true;
  try{button.click()}finally{queueMicrotask(()=>{suppressNativeConfirm=false})}
}
function init(){
  const reset=$('resetBtn'),restart=$('restartBtn');
  window.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    if(!target)return;
    if(reset&&target.closest('#resetBtn')===reset){
      if(allowReset){allowReset=false;return}
      event.preventDefault();event.stopImmediatePropagation();
      openConfirm('Reset everything','This will clear the current rotation, results, and player list. Continue?','Reset',()=>runOriginal(reset,v=>{allowReset=v}));
      return;
    }
    if(restart&&target.closest('#restartBtn')===restart){
      if(allowRestart){allowRestart=false;return}
      event.preventDefault();event.stopImmediatePropagation();
      openConfirm('Restart live session','This will clear completed game results and start the live session again. Continue?','Restart',()=>runOriginal(restart,v=>{allowRestart=v}));
    }
  },true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
