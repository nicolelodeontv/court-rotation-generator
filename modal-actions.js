(()=>{'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nativeConfirm=window.confirm.bind(window);
let bypassConfirm=false;
window.confirm=(message)=>{
  if(bypassConfirm){bypassConfirm=false;return true}
  return nativeConfirm(message)
};
function openConfirm(title,message,actionLabel,action){
  const sheet=$('sheet'),content=$('sheetContent');
  if(!sheet||!content)return action();
  content.innerHTML=`<div class="sheet-title">${esc(title)}</div><p class="hint">${esc(message)}</p><div class="confirm-actions"><button type="button" class="btn secondary" id="modalCancel">Cancel</button><button type="button" class="btn full" id="modalConfirm">${esc(actionLabel)}</button></div>`;
  sheet.hidden=false;
  const cancel=$('modalCancel'),confirmBtn=$('modalConfirm');
  cancel?.addEventListener('click',()=>{sheet.hidden=true},{once:true});
  confirmBtn?.addEventListener('click',()=>{sheet.hidden=true;action()},{once:true});
}
function init(){
  const reset=$('resetBtn'),restart=$('restartBtn');
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    if(!target)return;
    if(reset&&target.closest('#resetBtn')===reset){
      if(bypassConfirm)return;
      event.preventDefault();event.stopImmediatePropagation();
      openConfirm('Reset everything','This will clear the current rotation, results, and player list. Continue?','Reset',()=>{bypassConfirm=true;reset.click()});
      return;
    }
    if(restart&&target.closest('#restartBtn')===restart){
      if(restart.dataset.confirmBypass==='1'){delete restart.dataset.confirmBypass;return}
      event.preventDefault();event.stopImmediatePropagation();
      openConfirm('Restart live session','This will clear completed game results and start the live session again. Continue?','Restart',()=>{restart.dataset.confirmBypass='1';restart.click()});
    }
  },true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
