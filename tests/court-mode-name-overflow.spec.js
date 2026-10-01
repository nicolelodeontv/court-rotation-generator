const { test, expect } = require('@playwright/test');

const LONG_NAMES = [
  'AlexandertheExtraordinarilyLongNameOne',
  'BeatricetheSuperLongPlayerNameTwo',
  'ChristopherWithAVeryLongPlayerNameThree',
  'DominiqueAnotherExceptionallyLongNameFour',
  'EmilianotheLongestPlayerNameFive',
];

async function stubClipboard(page) {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async value => { window.__crgCopiedText = String(value); } },
      });
    } catch {}
  });
}

async function generate(page, courts = 1) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#courts').fill(String(courts));
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(LONG_NAMES.join('\n'));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(5, { timeout: 5000 });
  await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });
}

async function assertNamesVisible(page, selector) {
  const metrics = await page.locator(selector).evaluateAll(nodes => nodes.map(node => ({
    text: node.textContent.trim(),
    width: node.getBoundingClientRect().width,
    height: node.getBoundingClientRect().height,
    visible: getComputedStyle(node).visibility !== 'hidden' &&
      getComputedStyle(node).display !== 'none' &&
      node.getBoundingClientRect().height > 0,
  })));
  expect(metrics.length).toBeGreaterThan(0);
  for (const item of metrics) {
    expect(item.visible, `name should be visible: ${item.text}`).toBeTruthy();
  }
}

test('Court Mode keeps long player names inside the player cards at 390px and 1280px', async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await generate(page);

    await page.locator('#courtModeBtn').click();
    await expect(page.locator('body.court-mode')).toBeVisible();
    await expect(page.locator('body.court-mode #currentTeams .crg-team-player-name').first()).toBeVisible();

    const cards = page.locator('body.court-mode #currentTeams .crg-team-side');
    await expect(cards).toHaveCount(2);
    const cardMetrics = await cards.evaluateAll(nodes => nodes.map(node => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    })));
    for (const metric of cardMetrics) {
      expect(metric.scrollWidth, `Court Mode card overflowed: ${JSON.stringify(metric)}`).toBeLessThanOrEqual(metric.clientWidth);
    }

    await assertNamesVisible(page, 'body.court-mode #currentTeams .crg-team-player-name');
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
  }
});

test('Long names remain contained in a two-court Live session', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await generate(page, 2);

  const cards = page.locator('#courtCards .court-card');
  await expect(cards).toHaveCount(2);
  for (let i = 0; i < await cards.count(); i++) {
    const card = cards.nth(i);
    const metrics = await card.evaluate(node => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }));
    expect(metrics.scrollWidth, `two-court card overflowed: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.clientWidth);
    await assertNamesVisible(card, '.crg-team-player-name');
  }
});

test('Long names remain contained in the spectator view', async ({ page, context }) => {
  await stubClipboard(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await generate(page);

  await page.locator('[data-view="moreView"]').click();
  await page.locator('#copyFrozenSnapshotBtn').click();
  await expect.poll(() => page.evaluate(() => window.__crgCopiedText || ''), { timeout: 5000 }).toContain('?s=');

  const spectator = await context.newPage();
  await stubClipboard(spectator);
  try {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      await spectator.setViewportSize(viewport);
      await spectator.goto(await page.evaluate(() => window.__crgCopiedText));
      await spectator.waitForLoadState('domcontentloaded');
      await expect(spectator.locator('.spectator-layout')).toBeVisible({ timeout: 5000 });
      const names = spectator.locator('.spectator-player-name');
      await expect(names.first()).toBeVisible();
      expect(await spectator.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(await spectator.evaluate(() => document.documentElement.clientWidth));
    }
  } finally {
    await spectator.close();
  }
});
