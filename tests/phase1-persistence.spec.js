const { test, expect } = require('@playwright/test');

const roster = count => Array.from({ length: count }, (_, i) => `Player ${i + 1}`).join('\n');

async function generateSession(page, playerCount) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(playerCount));
  await page.locator('#playerConfirm').click();
  await expect(page.locator('#playerList .player-row')).toHaveCount(playerCount, { timeout: 2000 });
  await page.locator('#generateBtn').click();
  await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });
}

async function readLiveState(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('crg-live-state-v1');
    return raw ? JSON.parse(raw) : null;
  });
}

async function setSavedAt(page, savedAt) {
  await page.evaluate(value => {
    const key = 'crg-live-state-v1';
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('Live state missing');
    const data = JSON.parse(raw);
    data.savedAt = value;
    localStorage.setItem(key, JSON.stringify(data));
  }, savedAt);
}

async function waitForWorkerActive(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => navigator.serviceWorker?.getRegistration().then(Boolean),
    null,
    { timeout: 5000 }
  );

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => Boolean(navigator.serviceWorker?.controller),
    null,
    { timeout: 5000 }
  );
}

test('Active/Resting toggle survives reload', async ({ page }) => {
  await generateSession(page, 6);

  await page.locator('[data-view="playersView"]').click();
  await expect(page.locator('#playerCards')).toBeVisible();
  await page.locator('[data-active="1"]').uncheck();
  await expect(page.locator('[data-active="1"]')).not.toBeChecked();

  const beforeReload = await readLiveState(page);
  expect(beforeReload.active).not.toContain(1);

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });

  await page.locator('[data-view="playersView"]').click();
  await expect(page.locator('[data-active="1"]')).not.toBeChecked();

  const afterReload = await readLiveState(page);
  expect(afterReload.active).not.toContain(1);
});

test('Generated session survives reload', async ({ page }) => {
  await generateSession(page, 8);

  const before = await readLiveState(page);
  expect(before.games.length).toBeGreaterThan(0);
  expect(before.sessionCode).toBeTruthy();

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });

  const after = await readLiveState(page);
  expect(after.games.length).toBe(before.games.length);
  expect(after.sessionCode).toBe(before.sessionCode);
});

test('savedAt is written on save', async ({ page }) => {
  await generateSession(page, 4);

  const data = await readLiveState(page);
  expect(Number.isFinite(data.savedAt)).toBe(true);
  expect(Date.now() - data.savedAt).toBeLessThan(5000);
});

test('A session just under 12 hours old still restores', async ({ page }) => {
  await generateSession(page, 4);
  await setSavedAt(page, Date.now() - (12 * 60 * 60 * 1000 - 60 * 1000)); // 11h59m ago

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });

  const data = await readLiveState(page);
  expect(data.games.length).toBeGreaterThan(0);
});

test('A session older than 12 hours is discarded and starts blank', async ({ page }) => {
  await generateSession(page, 4);
  await setSavedAt(page, Date.now() - (12 * 60 * 60 * 1000 + 60 * 1000)); // 12h1m ago

  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#setupView')).toHaveClass(/active/);
  await expect(page.locator('#playerCount')).toHaveText('0');

  const data = await page.evaluate(() => localStorage.getItem('crg-live-state-v1'));
  expect(data).toBeNull();
});

test('Offline navigation loads the app after the worker has populated its cache', async ({ page, context }) => {
  await waitForWorkerActive(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#generateBtn')).toBeVisible({ timeout: 5000 });

  await context.setOffline(false);
});

test('Online navigation prefers fresh JS over an existing cached copy', async ({ page }) => {
  await waitForWorkerActive(page);

  await page.evaluate(async () => {
    const cache = await caches.open('crg-cache-v1');
    const requests = await cache.keys();
    const appRequest = requests.find(request => new URL(request.url).pathname.endsWith('/app.js'));
    if (!appRequest) throw new Error('Cached app.js not found');

    await cache.put(
      appRequest,
      new Response('throw new Error("STALE_APP_JS_WAS_SERVED");', {
        headers: { 'Content-Type': 'application/javascript' },
      })
    );
  });

  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#generateBtn')).toBeVisible({ timeout: 5000 });

  expect(errors).not.toContain('STALE_APP_JS_WAS_SERVED');
});
