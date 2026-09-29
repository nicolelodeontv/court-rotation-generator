const { test, expect } = require('@playwright/test');
const roster = count => Array.from({ length: count }, (_, i) => 'Player ' + (i + 1)).join('\n');

async function generateSession(page, playerCount = 8, courts = 2) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#courts').fill(String(courts));
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(playerCount));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });
}

async function readState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('crg-live-state-v1')));
}

async function recordCurrentResult(page) {
  await page.locator('#completeBtn').click();
  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
}

test('v1 restore migrates to v2 and waits when two courts share a player', async ({ page }) => {
  await generateSession(page, 8);
  const seed = await readState(page);
  await page.evaluate(data => {
    const games = data.games.map(g => ({ ...g, teams: g.teams.map(t => t.slice()), sitting: (g.sitting || []).slice() }));
    games[1].court = 2;
    games[1].teams = games[0].teams.map(team => team.slice());
    data.v = 1;
    data.gameStartedAt = Date.now() - 5000;
    delete data.gameStartedAtByIndex;
    delete data.waitingCourts;
    data.gameTimerPaused = false;
    data.timerPausedIndex = null;
    data.games = games;
    localStorage.setItem('crg-live-state-v1', JSON.stringify(data));
  }, seed);
  await page.reload();
  await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });
  const migrated = await readState(page);
  expect(migrated.v).toBe(2);
  expect(Number.isFinite(Number(migrated.gameStartedAtByIndex['0']))).toBeTruthy();
  expect(migrated.gameStartedAtByIndex['1']).toBeUndefined();
  expect(migrated.waitingCourts['2']).toMatchObject({ gameIndex: 1, blockingCourt: 1 });
  expect(migrated.waitingCourts['2'].player).toBe(seed.games[0].teams.flat()[0]);
});

test('court 1 completion starts its next game while court 2 timer keeps its original timestamp', async ({ page }) => {
  await generateSession(page, 8);
  const before = await readState(page);
  const court2Started = Number(before.gameStartedAtByIndex['1']);
  expect(Number.isFinite(court2Started)).toBeTruthy();
  await page.waitForTimeout(1100);
  await recordCurrentResult(page);
  await expect.poll(async () => (await readState(page)).gameStartedAtByIndex['2']).not.toBeUndefined();
  const after = await readState(page);
  expect(Number(after.gameStartedAtByIndex['1'])).toBe(court2Started);
  expect(Date.now() - court2Started).toBeGreaterThanOrEqual(1500);
  expect(Date.now() - court2Started).toBeLessThan(6000);
});

test('a court waits on a player in an active game, then starts after that game completes', async ({ page }) => {
  await generateSession(page, 8);
  await page.evaluate(() => {
    const key = 'crg-live-state-v1';
    const data = JSON.parse(localStorage.getItem(key));
    const activePlayers = data.games[1].teams.flat();
    const overlapPlayer = activePlayers[0];
    const others = data.names.map((_, i) => i + 1).filter(id => !activePlayers.includes(id)).slice(0, 3);
    data.games[2].teams = [[overlapPlayer, others[0]], [others[1], others[2]]];
    data.games[2].sitting = data.names.map((_, i) => i + 1).filter(id => !data.games[2].teams.flat().includes(id));
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();
  await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });
  await recordCurrentResult(page);
  const waiting = await readState(page);
  expect(waiting.waitingCourts['1']).toMatchObject({ gameIndex: 2, blockingCourt: 2 });
  expect(waiting.waitingCourts['1'].player).toBe(waiting.games[1].teams.flat()[0]);
  expect(waiting.gameStartedAtByIndex['2']).toBeUndefined();
  await recordCurrentResult(page);
  const started = await readState(page);
  expect(started.done).toContain(1);
  expect(Number.isFinite(Number(started.gameStartedAtByIndex['2']))).toBeTruthy();
  expect(started.waitingCourts['1']).toBeUndefined();
});

test('shuffle during a live game leaves every started game teams and court unchanged', async ({ page }) => {
  await generateSession(page, 8);
  const before = await readState(page);
  const startedGames = [0, 1].map(i => ({ index: i, teams: before.games[i].teams, court: before.games[i].court }));
  await page.locator('[data-view="scheduleView"]').click();
  await page.locator('#shuffleBtn').click();
  await expect(page.locator('#setupStatus')).toContainText('Shuffled the remaining games', { timeout: 5000 });
  const after = await readState(page);
  for (const item of startedGames) {
    expect(after.games[item.index].teams).toEqual(item.teams);
    expect(after.games[item.index].court).toBe(item.court);
  }
  expect(after.config.effectiveCourts).toBe(2);
});

test('reload while one result timer is paused preserves other court start timestamps', async ({ page }) => {
  await generateSession(page, 8);
  const before = await readState(page);
  const court1StartedBefore = Number(before.gameStartedAtByIndex['0']);
  const court2Started = Number(before.gameStartedAtByIndex['1']);
  await page.locator('#completeBtn').click();
  const paused = await readState(page);
  expect(paused.v).toBe(2);
  expect(paused.gameTimerPaused).toBe(true);
  expect(paused.timerPausedIndex).toBe(0);
  expect(Number(paused.gameDurations['0'])).toBeGreaterThanOrEqual(0);
  expect(Number(paused.gameStartedAtByIndex['1'])).toBe(court2Started);
  await page.reload();
  await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });
  await page.waitForTimeout(1100);
  const restored = await readState(page);
  expect(restored.gameTimerPaused).toBe(false);
  expect(restored.timerPausedIndex).toBe(null);
  expect(Number(restored.gameStartedAtByIndex['1'])).toBe(court2Started);
  expect(Number(restored.gameStartedAtByIndex['0'])).not.toBe(court1StartedBefore);
  expect(Date.now() - Number(restored.gameStartedAtByIndex['0'])).toBeGreaterThanOrEqual(1000);
});

test('single-court sessions keep the old single-current-card behavior', async ({ page }) => {
  await generateSession(page, 4);
  const state = await readState(page);
  expect(state.config.effectiveCourts).toBe(1);
  expect(Object.keys(state.gameStartedAtByIndex)).toEqual(['0']);
  await expect(page.locator('#currentCourt')).toHaveText('COURT 1');
  await recordCurrentResult(page);
  const after = await readState(page);
  expect(after.done).toContain(0);
  expect(Object.keys(after.gameStartedAtByIndex)).toEqual(['1']);
});
