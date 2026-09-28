
const fs=require('fs');
const {test,expect}=require('@playwright/test');

const names=['Ottilie Donaldson','Vincent Bullock','Joao Reynolds','Mia','Leo','Zoe'];

async function prepare(page,width,height){
  await page.addInitScript(()=>{try{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async v=>{window.__crgCopiedText=String(v)}}})}catch{}});
  await page.setViewportSize({width,height});
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(()=>localStorage.clear());
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}
async function generate(page){
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(names.join('\n'));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('#setupStatus')).toContainText('Rotation ready',{timeout:8000});
}
async function complete(page,a='',b=''){
  await page.locator('#completeBtn').click();
  await expect(page.locator('[data-winner="0"]')).toBeVisible();
  await page.locator('[data-winner="0"]').click();
  if(a!=='')await page.locator('#scoreA').fill(String(a));
  if(b!=='')await page.locator('#scoreB').fill(String(b));
  await page.locator('#scoreConfirm').click();
  await expect(page.locator('.sheet')).toBeHidden({timeout:3000});
}
async function overflow(page){
  return page.evaluate(()=>document.body.scrollWidth>document.documentElement.clientWidth);
}

test('Host Live stays balanced on desktop and stacks cleanly on tablet/mobile',async({page})=>{
  for(const width of [1280,1440,1920]){
    await prepare(page,width,900);await generate(page);
    const data=await page.evaluate(()=>{
      const grid=document.querySelector('#liveView .live-grid'),left=document.querySelector('#liveView .live-main-column'),right=document.querySelector('#liveView .live-upnext-column');
      const cards=[...document.querySelectorAll('#upNextList .next-item')],r=n=>n.getBoundingClientRect();
      const lr=r(left),rr=r(right);
      return {display:getComputedStyle(grid).display,ratio:lr.width/(lr.width+rr.width),left:lr.width,right:rr.width,cards:cards.map(n=>({w:r(n).width,h:r(n).height,scroll:n.scrollHeight,client:n.clientHeight})),overflow:document.body.scrollWidth>document.documentElement.clientWidth};
    });
    expect(data.display).toBe('grid');expect(data.left).toBeGreaterThanOrEqual(420);expect(data.ratio).toBeGreaterThan(.54);expect(data.ratio).toBeLessThan(.59);expect(data.overflow).toBeFalsy();
    expect(data.cards.length).toBeGreaterThan(0);
    expect(data.cards.every(x=>Math.abs(x.w-data.cards[0].w)<1)).toBeTruthy();
    expect(data.cards.every(x=>Math.abs(x.h-data.cards[0].h)<1)).toBeTruthy();
    expect(data.cards.every(x=>x.scroll<=x.client+1)).toBeTruthy();
  }
  for(const width of [768,1024,320,360,375,390,430]){
    await prepare(page,width,width<700?667:900);await generate(page);
    const data=await page.evaluate(()=>{
      const grid=document.querySelector('#liveView .live-grid'),left=document.querySelector('#liveView .live-main-column')?.getBoundingClientRect(),right=document.querySelector('#liveView .live-upnext-column')?.getBoundingClientRect(),cards=[...document.querySelectorAll('#upNextList .next-item')],names=[...document.querySelectorAll('#currentTeams .live-player-name')];
      const gs=getComputedStyle(grid),r=n=>n.getBoundingClientRect();
      return {display:gs.display,columns:gs.gridTemplateColumns,stacked:!!left&&!!right&&right.top>=left.bottom-1,names:names.map(n=>{const s=getComputedStyle(n);return{white:s.whiteSpace,break:s.wordBreak,wrap:s.overflowWrap,height:r(n).height}}),cards:cards.map(n=>({h:r(n).height,scroll:n.scrollHeight,client:n.clientHeight})),overflow:document.body.scrollWidth>document.documentElement.clientWidth};
    });
    if(width>700){expect(data.display).toBe('grid');expect(data.columns.split(' ').length).toBe(1)}else{expect(data.display).toBe('block')}
    expect(data.stacked).toBeTruthy();expect(data.overflow).toBeFalsy();
    expect(data.names.every(n=>n.white==='nowrap'&&n.break==='normal'&&n.wrap==='normal'&&n.height<80)).toBeTruthy();
    expect(data.cards.every(x=>x.scroll<=x.client+1)).toBeTruthy();
  }
});

test('Complete game stores optional scores and exposes winner, win time, and score in host views/CSV',async({page})=>{
  test.setTimeout(30000);
  await prepare(page,1024,900);await generate(page);
  await page.waitForTimeout(1200);await complete(page);
  await expect(page.locator('#matchLog')).toContainText('Winner:');
  await expect(page.locator('#matchLog')).toContainText('Won in 00:');
  await expect(page.locator('#matchLog')).not.toContainText('Team A won');
  const one=await page.evaluate(()=>JSON.parse(localStorage.getItem('crg-live-state-v1')||'null'));
  expect(one?.scores?.['0']).toBeUndefined();expect(one?.gameDurations?.['0']).toBeGreaterThanOrEqual(1);
  await complete(page,11,7);
  await expect(page.locator('#matchLog')).toContainText('11 – 7');
  await expect(page.locator('#scheduleList')).toContainText('11 – 7');
  const two=await page.evaluate(()=>JSON.parse(localStorage.getItem('crg-live-state-v1')||'null'));
  expect(two?.scores?.['1']).toEqual({a:11,b:7});
  await page.locator('[data-view="moreView"]').click();await expect(page.locator('#csvBtn')).toBeVisible();
  const downloadPromise=page.waitForEvent('download');await page.locator('#csvBtn').click();
  const download=await downloadPromise;const p=await download.path();const csv=p?fs.readFileSync(p,'utf8'):'';
  expect(csv).toContain('Win Time');expect(csv).toContain('Score');expect(csv).toContain('Winner:');expect(csv).toContain('11 – 7');
});

test('Spectator layout uses large word-safe names, team boxes, shared spacing, and result details',async({page,context})=>{
  test.setTimeout(40000);
  await prepare(page,1024,900);await generate(page);await complete(page,11,7);await page.locator('[data-view="moreView"]').click();await page.locator('#copyFrozenSnapshotBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__crgCopiedText||''),{timeout:5000}).toContain('?s=');
  const url=await page.evaluate(()=>window.__crgCopiedText);const spectator=await context.newPage();
  try{
    for(const width of [320,375,430,768,1280,1920]){
      await spectator.setViewportSize({width,height:900});await spectator.goto(url);await spectator.waitForLoadState('domcontentloaded');await expect(spectator.locator('.spectator-layout')).toBeVisible({timeout:5000});
      const data=await spectator.evaluate(()=>{
        const layout=document.querySelector('.spectator-layout'),game=document.querySelector('.spectator-game'),names=[...document.querySelectorAll('.spectator-player-name')],up=document.querySelector('.spectator-upnext'),log=document.querySelector('.spectator-match-log'),result=game?.querySelector('.spectator-result-summary');
        const sections=[...document.querySelectorAll('.spectator-layout>.spectator-section')],styles=layout?getComputedStyle(layout):null; return {layoutGap:styles?.rowGap||'',sections:sections.map(s=>({margin:getComputedStyle(s).margin,padding:getComputedStyle(s).padding,radius:getComputedStyle(s).borderRadius})),teams:game?[...game.querySelectorAll(':scope>.spectator-matchup>.spectator-team')].length:0,and:game?[...game.querySelectorAll('.spectator-and')].length:0,vs:game?.querySelector('.spectator-vs')?.textContent.trim()||'',labels:game?[...game.querySelectorAll('.spectator-team-players')].map(n=>n.textContent):[],names:names.map(n=>{const s=getComputedStyle(n);return{font:parseFloat(s.fontSize),white:s.whiteSpace,break:s.wordBreak,wrap:s.overflowWrap,scroll:n.scrollHeight,client:n.clientHeight}}),result:result?.textContent||'',up:up?.textContent||'',log:log?.textContent||'',overflow:document.body.scrollWidth>document.documentElement.clientWidth};
      });
      expect(data.layoutGap).toBe('16px');expect(data.sections.length).toBe(6);expect(data.sections.every(s=>s.margin==='0px')).toBeTruthy();expect(new Set(data.sections.map(s=>s.padding)).size).toBe(1);expect(new Set(data.sections.map(s=>s.radius)).size).toBe(1);
      expect(data.teams).toBe(2);expect(data.and).toBe(2);expect(data.vs).toBe('vs');expect(data.labels.some(t=>/TEAM A|TEAM B/.test(t))).toBeFalsy();expect(data.labels.some(t=>t.includes('and'))).toBeTruthy();
      expect(data.names.every(n=>n.font>=18&&n.white==='nowrap'&&n.break==='normal'&&n.wrap==='normal'&&n.scroll<=n.client+1)).toBeTruthy();
      expect(data.result).toContain('Winner:');expect(data.result).toContain('Won in');expect(data.result).toContain('11');expect(data.result).toContain('7');expect(data.up).toContain('GAME');expect(data.log).toContain('Winner:');expect(data.overflow).toBeFalsy();
    }
  }finally{await spectator.close()}
});
