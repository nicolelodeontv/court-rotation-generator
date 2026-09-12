/* Force Shuffle / Rebalance to use the existing rebuild path.
   The rebuild logic preserves completed + locked games and regenerates only the rest. */
(()=>{
  'use strict';
  const nativeAddEventListener=EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener=function(type,listener,options){
    if(this?.id==='shuffleBtn'&&type==='click'&&typeof listener==='function'){
      return nativeAddEventListener.call(this,'click',event=>{
        event.preventDefault();
        event.stopImmediatePropagation();
        document.getElementById('rebuildBtn')?.click();
      },options);
    }
    return nativeAddEventListener.call(this,type,listener,options);
  };
})();
