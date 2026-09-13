/* Keep shuffle responsive: use the existing rebuild path exactly once. */
(()=>{
  'use strict';
  const btn=document.getElementById('shuffleBtn');
  if(!btn||btn.dataset.crgPerfFixed)return;
  btn.dataset.crgPerfFixed='1';
  btn.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    const rebuild=document.getElementById('rebuildBtn');
    if(rebuild&&!rebuild.disabled){
      rebuild.click();
    }
  },true);
})();
