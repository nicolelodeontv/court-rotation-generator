const { test, expect } = require('@playwright/test');

const LONG_NAME = 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMN';
const name = index => `Player ${String(index).padStart(2, '0')}`;

test('name and roster limits are enforced at input boundaries', async ({ page }) => {
  await page.goto('/');
  const names = Array.from({ length: 45 }, (_, i) => `${name(i + 1)} ${LONG_NAME}`);
  await page.locator('#names').fill(names.join('\n'));

  const values = await page.locator('#names').inputValue();
  const lines = values.split('\n').filter(Boolean);
  expect(lines).toHaveLength(40);
  expect(Math.max(...lines.map(value => [...value].length))).toBeLessThanOrEqual(40);
  await expect(page.locator('#setupStatus')).toContainText('40 characters');
  await expect(page.locator('#setupStatus')).toContainText('40 players');

  await page.locator('#addPlayerBtn').click();
  await expect(page.locator('#playerCount')).toHaveText('40');
  await expect(page.locator('#setupStatus')).toContainText('Roster limit is 40 players');
});

test('paste names are limited to 40 characters and 40 players', async ({ page }) => {
  await page.goto('/');
  await page.locator('#pasteBtn').click();
  const names = Array.from({ length: 45 }, (_, i) => `${name(i + 1)} ${LONG_NAME}`);
  await page.locator('#sheetPaste').fill(names.join('\n'));
  await page.locator('#usePaste').click();

  const values = await page.locator('#names').inputValue();
  const lines = values.split('\n').filter(Boolean);
  expect(lines).toHaveLength(40);
  expect(Math.max(...lines.map(value => [...value].length))).toBeLessThanOrEqual(40);
  await expect(page.locator('#setupStatus')).toContainText('40 players');
});

test('restoring an old-format saved session generates a new code and keeps the session', async ({ page }) => {
  const saved = {
    v: 1,
    names: ['Alice', 'Bob', 'Carol', 'Dave'],
    active: [1, 2, 3, 4],
    games: [{ teams: [[1, 2], [3, 4]], sitting: [], court: 1 }],
    done: [],
    results: {},
    scores: {},
    winByTwo: false,
    scoreWinByTwo: {},
    locked: [],
    score: 10,
    config: { names: ['Alice', 'Bob', 'Carol', 'Dave'], per: 1, courts: 1 },
    sessionCode: 'CRG-OLD1234',
    playerTargets: {},
    playerMeta: {},
    gameDurations: {},
    gameStartedAt: null,
    gameTimerPaused: false,
    timerPausedIndex: null,
  };

  await page.addInitScript(savedState => {
    localStorage.setItem('crg-live-state-v1', JSON.stringify(savedState));
    localStorage.setItem('crg-supabase-host-key-v1:CRG-OLD1234', 'legacy-test-secret');
  }, saved);

  await page.goto('/');
  const label = await page.locator('#sessionCodeText').textContent();
  const code = String(label || '').match(/CRG-[A-Z0-9]+/)?.[0] || '';
  expect(code).toMatch(/^CRG-[A-HJ-NP-Z2-9]{10}$/);
  expect(code).not.toBe('CRG-OLD1234');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('crg-live-state-v1')));
  expect(stored.sessionCode).toBe(code);
  expect(stored.names).toEqual(saved.names);
  expect(await page.evaluate(() => localStorage.getItem('crg-supabase-host-key-v1:CRG-OLD1234'))).toBeNull();
  await expect(page.locator('#setupStatus')).toContainText('new session code');
  await expect(page.locator('.game-row')).toHaveCount(1);
});
