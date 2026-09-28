const { test, expect } = require('@playwright/test');

const LONG_ADD_NAME = 'Add ' + 'X'.repeat(60);
const LONG_MID_NAME = 'Mid ' + 'Y'.repeat(60);
const longPasteName = index => `Player ${String(index).padStart(2, '0')} ${'Z'.repeat(60)}`;

async function addPlayer(page, value) {
  await page.locator('#playerAddBtn').click();
  await page.locator('#newPlayerName').fill(value);
  await page.locator('#playerConfirm').click();
}

test('visible Add player and mid-session Add player enforce the 40-character limit', async ({ page }) => {
  await page.goto('/');
  for (const player of ['Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi']) {
    await addPlayer(page, player);
  }
  await addPlayer(page, LONG_ADD_NAME);

  await expect(page.locator('.player-row')).toHaveCount(8);
  const initialLengths = await page.locator('.player-row .player-name').evaluateAll(nodes =>
    nodes.map(node => [...node.textContent.trim()].length)
  );
  expect(Math.max(...initialLengths)).toBeLessThanOrEqual(40);
  await expect(page.locator('#setupStatus')).toContainText('40 characters');

  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match').first()).toBeVisible({ timeout: 5000 });

  await page.locator('#addMidSessionPlayerBtn').click();
  await page.locator('#midSessionPlayerName').fill(LONG_MID_NAME);
  await page.locator('#midPlayerConfirm').click();

  await expect(page.locator('#playerList .player-row')).toHaveCount(9);
  const finalNames = await page.locator('#playerList .player-name').evaluateAll(nodes =>
    nodes.map(node => node.textContent.trim())
  );
  expect(Math.max(...finalNames.map(value => [...value].length))).toBeLessThanOrEqual(40);
  expect(finalNames).toContain('Mid ' + 'y'.repeat(36));
  await expect(page.locator('#setupStatus')).toContainText('40 characters');
});

test('mid-session Add rolls back cleanly when the new player cannot fit', async ({ page }) => {
  await page.goto('/');
  for (const player of ['Alice', 'Bob', 'Carol', 'Dave']) await addPlayer(page, player);
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(3, { timeout: 5000 });

  await page.locator('#addMidSessionPlayerBtn').click();
  await page.locator('#midSessionPlayerName').fill('New Player');
  await page.locator('#midPlayerConfirm').click();

  await expect(page.locator('#playerList .player-row')).toHaveCount(4);
  await expect(page.locator('#midPlayerError')).toContainText('Could not fairly fit the new player');
});

test('visible Paste names caps the roster at 40 and reports both limits', async ({ page }) => {
  await page.goto('/');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(
    Array.from({ length: 45 }, (_, index) => longPasteName(index + 1)).join('\n')
  );
  await page.locator('#playerConfirm').click();

  await expect(page.locator('#playerList .player-row')).toHaveCount(40);
  const lengths = await page.locator('#playerList .player-name').evaluateAll(nodes =>
    nodes.map(node => [...node.textContent.trim()].length)
  );
  expect(Math.max(...lengths)).toBeLessThanOrEqual(40);
  await expect(page.locator('#setupStatus')).toContainText('40 characters');
  await expect(page.locator('#setupStatus')).toContainText('40 players');

  await page.locator('#playerAddBtn').click();
  await page.locator('#newPlayerName').fill('Extra ' + 'Q'.repeat(60));
  await page.locator('#playerConfirm').click();
  await expect(page.locator('#playerList .player-row')).toHaveCount(40);
  await expect(page.locator('#setupStatus')).toContainText('40 players');
});

test('restoring an old-format saved session generates a new code, migrates immediately, and keeps session state', async ({ page }) => {
  const oldCode = 'CRG-OLD1234';
  const longLegacyName = 'legacyname' + 'x'.repeat(50);
  const saved = {
    v: 1,
    names: [longLegacyName, 'Bob', 'Carol', 'Dave'],
    active: [1, 2, 3, 4],
    games: [
      { teams: [[1, 2], [3, 4]], sitting: [], court: 1 },
      { teams: [[1, 3], [2, 4]], sitting: [], court: 1 },
    ],
    done: [0],
    results: { 0: 0 },
    scores: { 0: { a: 11, b: 7 } },
    winByTwo: false,
    scoreWinByTwo: { 0: false },
    locked: [],
    score: 10,
    config: { names: [longLegacyName, 'Bob', 'Carol', 'Dave'], per: 1, courts: 1 },
    sessionCode: oldCode,
    playerTargets: { 1: 1, 2: 1, 3: 1, 4: 1 },
    playerMeta: {},
    gameDurations: { 0: 17 },
    gameStartedAt: 1700000000000,
    gameTimerPaused: false,
    timerPausedIndex: null,
    view: 'liveView',
  };

  await page.addInitScript(({ savedState, code }) => {
    const originalSetItem = Storage.prototype.setItem;
    window.__crgRestoreSaveStacks = [];
    Storage.prototype.setItem = function(key, value) {
      if (key === 'crg-live-state-v1') window.__crgRestoreSaveStacks.push(String(new Error().stack || ''));
      return originalSetItem.call(this, key, value);
    };
    localStorage.setItem('crg-live-state-v1', JSON.stringify(savedState));
    localStorage.setItem('crg-supabase-host-key-v1:' + code, 'legacy-test-secret');
    window.__crgRestoreSaveStacks = [];
  }, { savedState: saved, code: oldCode });

  await page.goto('/');

  const label = await page.locator('#sessionCodeText').textContent();
  const code = String(label || '').match(/CRG-[A-Z0-9]+/)?.[0] || '';
  expect(code).toMatch(/^CRG-[A-HJ-NP-Z2-9]{10}$/);
  expect(code).not.toBe(oldCode);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('crg-live-state-v1')));
  expect(stored.sessionCode).toBe(code);
  expect(stored.names).toHaveLength(4);
  expect([...stored.names[0]].length).toBe(40);
  expect(stored.names.slice(1)).toEqual(saved.names.slice(1));
  expect(stored.config.names).toEqual(stored.names);

  expect(stored.games).toEqual(saved.games);
  expect(stored.results).toEqual(saved.results);
  expect(stored.scores).toEqual(saved.scores);
  expect(stored.gameDurations).toEqual(saved.gameDurations);
  expect(stored.gameStartedAt).toBe(saved.gameStartedAt);
  expect(stored.gameTimerPaused).toBe(saved.gameTimerPaused);
  expect(stored.timerPausedIndex).toBe(saved.timerPausedIndex);
  expect(await page.locator('.view.active').getAttribute('id')).toBe('liveView');

  expect(await page.evaluate(codeValue =>
    localStorage.getItem('crg-supabase-host-key-v1:' + codeValue), oldCode
  )).toBeNull();
  await expect(page.locator('#setupStatus')).toContainText('new session code');

  const saveStacks = await page.evaluate(() => window.__crgRestoreSaveStacks || []);
  expect(saveStacks.some(stack =>
    stack.includes('restoreLiveState') && stack.includes('saveLiveState')
  )).toBeTruthy();
  await expect(page.locator('.game-row')).toHaveCount(2);
});
