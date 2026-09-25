const { test, expect } = require('@playwright/test');

const roster = count => Array.from({ length: count }, (_, i) => `Player ${i + 1}`).join('\n');

async function prepareClipboardCapture(page) {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async value => { window.__crgCopiedText = String(value); } },
      });
    } catch {}
  });
}

async function generateScenario(page, playerCount, expectedGames) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(playerCount));
  await page.locator('#playerConfirm').click();
  await expect(page.locator('#playerList .player-row')).toHaveCount(playerCount, { timeout: 2000 });

  await page.locator('#generateBtn').click();
  await expect(page.locator('#setupStatus')).toContainText('Rotation ready', { timeout: 5000 });
  await expect(page.locator('.game-match')).toHaveCount(expectedGames, { timeout: 3000 });
}

async function assertLiveFormatting(page, totalGames) {
  const sticky = page.locator('#stickyLive');
  await expect(sticky).toBeVisible();
  await expect(page.locator('#stickyGame')).toHaveText(new RegExp(`^Game 1 / ${totalGames} — `));
  await expect(page.locator('#stickyGame')).not.toContainText('1/');
  await expect(page.locator('#stickyGame')).not.toContainText(`${totalGames}Player`);
  await expect(page.locator('#stickyMatch')).toBeHidden();

  const skills = page.locator('#upNextList .live-player-stars');
  const players = page.locator('#upNextList .live-player-name');
  expect(await players.count(), 'Up Next should render player-name elements').toBeGreaterThan(0);
  expect(await skills.count(), 'Up Next should render star skill elements').toBeGreaterThan(0);
  const skillTexts = await skills.allTextContents();
  expect(skillTexts.every(text => /^\s*⭐{1,6}\s*$/.test(text))).toBeTruthy();
  const compactUpNext = (await page.locator('#upNextList').innerText()).replace(/\s+/g, ' ');
  expect(compactUpNext).not.toMatch(/[A-Za-z][A-Za-z]+⭐/);

  return (await page.locator('#currentTeams .live-player-name').allTextContents()).map(s => s.replace(/\s+⭐+$/, '').trim());
}

async function getSnapshotUrl(page) {
  await page.locator('[data-view="moreView"]').click();
  await expect(page.locator('#copyFrozenSnapshotBtn')).toBeVisible();
  await page.locator('#copyFrozenSnapshotBtn').click();
  await expect.poll(() => page.evaluate(() => window.__crgCopiedText || '')).toContain('?s=');
  return page.evaluate(() => window.__crgCopiedText);
}

async function assertSpectatorCurrentCard(browser, snapshotUrl, expectedNames, screenshotName) {
  const spectator = await browser.newPage();
  await spectator.goto(snapshotUrl);
  await spectator.waitForLoadState('domcontentloaded');
  await expect(spectator.locator('.spectator-current')).toBeVisible();

  const currentNames = spectator.locator('.spectator-current .spectator-player-name');
  await expect(currentNames).toHaveCount(expectedNames.length);
  const actual = (await currentNames.allTextContents()).map(s => s.trim());
  expect(actual).toEqual(expectedNames);

  const scheduleNames = spectator.locator('.spectator-game .spectator-player-name');
  expect(await scheduleNames.count()).toBeGreaterThanOrEqual(expectedNames.length);
  for (const name of expectedNames) {
    await expect(spectator.locator('.spectator-game').first()).toContainText(name);
  }

  await spectator.screenshot({ path: `test-results/${screenshotName}`, fullPage: true });
  await spectator.close();
}

test('36-game live formatting and spectator current card stay correct', async ({ page, browser }) => {
  await prepareClipboardCapture(page);
  await generateScenario(page, 24, 36);
  const currentNames = await assertLiveFormatting(page, 36);
  await page.screenshot({ path: 'test-results/live-36-game-formatting.png', fullPage: true });

  const snapshotUrl = await getSnapshotUrl(page);
  await assertSpectatorCurrentCard(browser, snapshotUrl, currentNames, 'spectator-current-36-games.png');
});

test('15-game live formatting and spectator current card stay correct', async ({ page, browser }) => {
  await prepareClipboardCapture(page);
  await generateScenario(page, 10, 15);
  const currentNames = await assertLiveFormatting(page, 15);
  await page.screenshot({ path: 'test-results/live-15-game-formatting.png', fullPage: true });

  const snapshotUrl = await getSnapshotUrl(page);
  await assertSpectatorCurrentCard(browser, snapshotUrl, currentNames, 'spectator-current-15-games.png');
});


test('Up Next swaps work in both directions and clear selection', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(8));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(12, { timeout: 5000 });
  for (let i = 0; i < 9; i++) await page.locator('#nextBtn').click({ force: true });
  expect(await page.locator('#upNextList [data-swap-game]').evaluateAll(btns => btns.map(b => Number(b.dataset.swapGame)))).toEqual([10, 11, 12]);
  const rows = page.locator('#upNextList .next-item');
  const before = await rows.evaluateAll(items => items.map(item => item.querySelectorAll('span')[1]?.innerText || ''));
  let pair = null;
  for (const [a, b] of [[10, 11], [10, 12], [11, 12]]) {
    await page.locator('[data-swap-game="'+a+'"]').click();
    await expect(page.locator('[data-swap-game="'+a+'"]')).toHaveText(/Swap selected/);
    await page.locator('[data-swap-game="'+b+'"]').click();
    if (await page.locator('#upNextSwapStatus').textContent().then(t => /Swapped Game/.test(t))) { pair = [a, b]; break; }
  }
  expect(pair, 'At least one upcoming pair should be swappable').not.toBeNull();
  const after = await rows.evaluateAll(items => items.map(item => item.querySelectorAll('span')[1]?.innerText || ''));
  expect(after).not.toEqual(before);
  expect(await page.locator('.upnext-swap.is-selected').count()).toBe(0);
  const [a, b] = pair;
  await page.locator('[data-swap-game="'+b+'"]').click();
  await expect(page.locator('[data-swap-game="'+b+'"]')).toHaveText(/Swap selected/);
  await page.locator('[data-swap-game="'+a+'"]').click();
  await expect(page.locator('#upNextSwapStatus')).toContainText('Swapped Game');
  expect(await rows.evaluateAll(items => items.map(item => item.querySelectorAll('span')[1]?.innerText || ''))).toEqual(before);
  expect(await page.locator('.upnext-swap.is-selected').count()).toBe(0);
});

test('Ranks tab uses the shared medal placement labels', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(4));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await page.locator('#completeBtn').click();
  await page.locator('[data-winner="0"]').click();
  await page.locator('[data-view="rankingsView"]').click();
  await expect(page.locator('.rank-row').first()).toBeVisible();
  const labels = await page.locator('.rank-pos').allTextContents();
  expect(labels.slice(0, 3)).toEqual(['🏆🥇 1st', '🥈 2nd', '🥉 3rd']);
});
