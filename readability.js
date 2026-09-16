(()=>{'use strict';
const KEY='crg-large-text-v1';
const $=id=>document.getElementById(id);
const read=()=>{try{const v=localStorage.getItem(KEY);return v===null?true:v==='1'}catch{return true}};
const write=v=>{try{localStorage.setItem(KEY,v?'1':'0')}catch{}};
function apply(){const enabled=read();document.body.classList.toggle('large-text',enabled);const b=$('largeTextBtn');if(b){b.textContent=`Large text: ${enabled?'On':'Off'}`;b.setAttribute('aria-pressed',String(enabled));}}
function bind(){const b=$('largeTextBtn');if(!b||b.dataset.readabilityBound==='1')return;if(b.dataset.readabilityBound!=='1'){b.dataset.readabilityBound='1';b.addEventListener('click',()=>{const enabled=!document.body.classList.contains('large-text');write(enabled);apply()})}apply()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
// Safe observer: bind() is guarded by data-readability-bound, so repeated child additions cannot rebind or recurse.
new MutationObserver(bind).observe(document.body,{childList:true,subtree:true});
})();
