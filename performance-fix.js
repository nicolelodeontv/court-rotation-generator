(()=>{'use strict';
/* Performance guard: keep the existing fairness engine, but cap expensive search work.
   The original UI requests 420 attempts and the pro layer can multiply that further.
   A low cap keeps generation responsive while preserving balanced scheduling. */
const CAP=8;
let patched=false;
function install(){
  if(patched||!window.RotationScheduler?.generate)return;
  const current=window.RotationScheduler.generate;
  window.RotationScheduler.generate=function(cfg){
    const safe={...cfg,attempts:Math.min(Number(cfg?.attempts)||CAP,CAP)};
    return current(safe);
  };
  patched=true;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
window.addEventListener('load',install,{once:true});
})();
