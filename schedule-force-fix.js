(()=>{
  'use strict';
  const shuffle=document.getElementById('shuffleBtn');
  if(!shuffle) return;

  // The original button correctly calls the generator, but that handler
  // returns the user to Live view. Keep the generated/rebalanced rotation
  // visible in Schedule so the action has an immediate, obvious result.
  shuffle.addEventListener('click',()=>{
    shuffle.classList.add('is-working');
    shuffle.setAttribute('aria-busy','true');
    shuffle.textContent='Rebalancing…';
    window.setTimeout(()=>{
      document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='scheduleView'));
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view==='scheduleView'));
      window.scrollTo({top:0,behavior:'smooth'});
      shuffle.classList.remove('is-working');
      shuffle.removeAttribute('aria-busy');
      shuffle.textContent='Shuffle / rebalance';
    },180);
  },true);
})();
