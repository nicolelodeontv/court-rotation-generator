const { test, expect } = require('@playwright/test');

const roster = count => Array.from({ length: count }, (_, i) => 'Player ' + (i + 1)).join('\n');

async function generateSession(page, playerCount = 10, courts = 2) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#courts').fill(String(courts));
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(playerCount));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });
}

async function readState(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('crg-live-state-v1'))); }
async function openAvailability(page) { await page.locator('#manageAvailabilityBtn').click(); await expect(page.locator('.roster-sheet')).toBeVisible(); }

test('dismiss discards staged availability changes', async ({ page }) => {
  await generateSession(page, 6, 1);
  const before = await readState(page);
  await openAvailability(page);
  await page.locator('[data-roster-active="1"]').uncheck();
  expect((await readState(page)).active).toEqual(before.active);
  await page.locator('#rosterCancel').click();
  await openAvailability(page);
  await expect(page.locator('[data-roster-active="1"]')).toBeChecked();
});

test('applying Resting removes the player from future unlocked games and survives reload', async ({ page }) => {
  await generateSession(page, 10, 2);
  const before = await readState(page);
  expect(Object.keys(before.gameStartedAtByIndex).length).toBe(2);
  await openAvailability(page);
  await page.locator('[data-roster-active="1"]').uncheck();
  await page.locator('#rosterApply').click();
  const after = await readState(page);
  expect(after.active).not.toContain(1);
  const currentSet = new Set(Object.keys(after.gameStartedAtByIndex).map(Number));
  for (let i=0;i<after.games.length;i++) {
    if(after.done.includes(i)||after.locked.includes(i)||currentSet.has(i)) continue;
    expect(after.games[i].teams.flat()).not.toContain(1);
  }
  await page.reload();
  expect((await readState(page)).active).not.toContain(1);
});

test('resting a player on a PLAYING court preserves the current game and timestamp', async ({ page }) => {
  await generateSession(page, 12, 2);
  const before = await readState(page);
  const currentIndex = Object.keys(before.gameStartedAtByIndex).map(Number).sort((a,b)=>a-b)[0];
  const targetId = before.games[currentIndex].teams.flat()[0];
  const startedAt = Number(before.gameStartedAtByIndex[String(currentIndex)]);
  const teams = before.games[currentIndex].teams;
  await openAvailability(page);
  await page.locator('[data-roster-active="' + targetId + '"]').uncheck();
  await page.locator('#rosterApply').click();
  const after = await readState(page);
  expect(after.games[currentIndex].teams).toEqual(teams);
  expect(Number(after.gameStartedAtByIndex[String(currentIndex)])).toBe(startedAt);
});

test('resting a player in a WAITING current slot releases and regenerates that slot', async ({ page }) => {
  await generateSession(page, 10, 2);
  await page.evaluate(() => {
    const key='crg-live-state-v1',data=JSON.parse(localStorage.getItem(key));
    const court2Players=data.games[1].teams.flat(),overlapPlayer=court2Players[0],others=data.names.map((_,i)=>i+1).filter(id=>!court2Players.includes(id)).slice(0,3);
    data.games[2].teams=[[overlapPlayer,others[0]],[others[1],others[2]]];
    data.games[2].sitting=data.names.map((_,i)=>i+1).filter(id=>!data.games[2].teams.flat().includes(id));
    data.done=[...new Set([...(data.done||[]),0])];
    delete data.gameStartedAtByIndex?.['0'];
    data.waitingCourts={};
    localStorage.setItem(key,JSON.stringify(data));
  });
  await page.reload();
  const before=await readState(page);
  expect(before.waitingCourts['1']).toMatchObject({gameIndex:2,blockingCourt:2});
  const waitingPlayer=before.games[2].teams.flat()[0];
  await openAvailability(page);
  await page.locator('[data-roster-active="' + waitingPlayer + '"]').uncheck();
  await page.locator('#rosterApply').click();
  const after=await readState(page);
  expect(after.active).not.toContain(waitingPlayer);
  expect(after.games[2].teams.flat()).not.toContain(waitingPlayer);
});

test('returning player is delayed past current games and remains near roster target', async ({ page }) => {
  await generateSession(page, 10, 2);
  await page.evaluate(() => {
    const key='crg-live-state-v1',data=JSON.parse(localStorage.getItem(key));
    const teams=[
      [[1,2],[3,4]],
      [[5,6],[7,8]],
      [[1,3],[5,7]],
      [[2,4],[6,8]],
      [[1,5],[2,6]],
      [[3,7],[4,8]]
    ];
    teams.forEach((pair,i)=>{data.games[i].teams=pair;data.games[i].sitting=[9,10];data.games[i].court=i%2+1;data.games[i].round=Math.floor(i/2)});
    data.active=[1,2,3,4,5,6,7,8];
    data.done=[0,1,2,3];
    data.gameStartedAtByIndex={'4':Date.now()-120000,'5':Date.now()-60000};
    data.waitingCourts={};
    data.locked=[];
    data.results={};
    data.scores={};
    data.gameDurations={};
    data.gameTimerPaused=false;
    data.timerPausedIndex=null;
    localStorage.setItem(key,JSON.stringify(data));
  });
  await page.reload();
  const before=await readState(page);
  const currentIndexes=Object.keys(before.gameStartedAtByIndex).map(Number).filter(i=>!before.done.includes(i));
  expect(currentIndexes).toEqual([4,5]);
  expect(before.active).toEqual([1,2,3,4,5,6,7,8]);
  expect(before.active).not.toContain(9);
  await openAvailability(page);
  await expect(page.locator('[data-roster-active="9"]')).not.toBeChecked();
  await page.locator('[data-roster-active="9"]').check();
  await page.locator('#rosterApply').click();
  await expect(page.locator('.roster-sheet')).toBeHidden();
  const after=await readState(page);
  expect(after.active).toContain(9);
  const earliest=Number(after.playerMeta[9].earliestEligibleGameIndex);
  expect(earliest).toBeGreaterThanOrEqual(Math.max(...currentIndexes)+1);
  currentIndexes.forEach(i=>expect(after.games[i].teams.flat()).not.toContain(9));
  const firstFutureIndex=after.games.findIndex((g,i)=>i>=earliest&&!after.done.includes(i)&&g.teams.flat().includes(9));
  expect(firstFutureIndex).toBeGreaterThanOrEqual(earliest);
  expect(firstFutureIndex).not.toBe(-1);
  const counts=Object.fromEntries(after.names.map((_,i)=>[i+1,0]));
  after.games.forEach((g,i)=>{if(after.done.includes(i))return;for(const id of g.teams.flat())counts[id]++});
  const others=Object.entries(counts).filter(([id])=>Number(id)!==9).map(([,count])=>count);
  expect(counts[9]).toBeLessThanOrEqual(Math.max(...others)+1);
});

test('under-four failure is atomic and keeps the sheet open', async ({ page }) => {
  await generateSession(page, 6, 1);
  const before=await readState(page);
  await openAvailability(page);
  for(const id of [1,2,3]) await page.locator('[data-roster-active="' + id + '"]').uncheck();
  await page.locator('#rosterApply').click();
  await expect(page.locator('#rosterAvailabilityError')).toHaveText('At least 4 players must stay available.');
  await expect(page.locator('.roster-sheet')).toBeVisible();
  const after=await readState(page);
  expect(after.active).toEqual(before.active);
  expect(after.games).toEqual(before.games);
  expect(after.playerMeta).toEqual(before.playerMeta);
});

test('court-count guard is atomic while two courts are active', async ({ page }) => {
  await generateSession(page, 8, 2);
  const before=await readState(page);
  await openAvailability(page);
  await page.locator('[data-roster-active="1"]').uncheck();
  await page.locator('#rosterApply').click();
  await expect(page.locator('#rosterAvailabilityError')).toContainText('At least 8 players must remain available');
  await expect(page.locator('.roster-sheet')).toBeVisible();
  const after=await readState(page);
  expect(after.active).toEqual(before.active);
  expect(after.games).toEqual(before.games);
});

test('availability sheet sits flush to the viewport bottom at 390px', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await generateSession(page, 6, 1);
  await openAvailability(page);
  await expect.poll(async () => {
    const box=await page.locator('.roster-sheet .sheet-panel').boundingBox();
    return box ? Math.abs((box.y+box.height)-844) <= 1 : false;
  }, { timeout: 1000 }).toBe(true);
  const box=await page.locator('.roster-sheet .sheet-panel').boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs((box.y+box.height)-844)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width-390)).toBeLessThanOrEqual(1);
});
