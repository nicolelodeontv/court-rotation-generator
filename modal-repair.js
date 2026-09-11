(()=>{'use strict';
const sync=()=>{
  const sheet=document.getElementById('sheet');
  if(!sheet)return;
  const open=!sheet.hidden;
  sheet.classList.toggle('modal-open',open);
  document.body.classList.toggle('modal-open',open);
  if(open)sheet.removeAttribute('aria-hidden');else sheet.setAttribute('aria-hidden','true');
};
const init=()=>{
  const sheet=document.getElementById('sheet');
  const close=document.getElementById('sheetClose');
  const backdrop=document.getElementById('sheetBackdrop');
  if(!sheet)return;
  const observer=new MutationObserver(sync);
  observer.observe(sheet,{attributes:true,attributeFilter:['hidden']});
  if(close)close.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();sheet.hidden=true;sync()},true);
  if(backdrop)backdrop.addEventListener('click',e=>{if(e.target===backdrop){sheet.hidden=true;sync()}},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden){sheet.hidden=true;sync()}},true);
  sync();
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
