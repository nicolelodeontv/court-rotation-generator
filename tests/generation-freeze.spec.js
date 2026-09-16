const { test, expect } = require('@playwright/test');

const roster = Array.from({ length: 24 }, (_, i) => `Player ${i + 1}`).join('\n');

test('page remains interactive after load and rotation generation', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    window.__crgSmokeClicks = 0;
    document.querySelector('#themeBtn')?.addEventListener('click', () => {
      window.__crgSmokeClicks += 1;
    });
  });

  await page.locator('#themeBtn').click({ timeout: 1000 });
  await expect.poll(() => page.evaluate(() => window.__crgSmokeClicks)).toBe(1);

  await page.locator('#playerPasteBtn').click({ timeout: 1000 });
  await page.locator('#pastePlayerNames').fill(roster, { timeout: 1000 });
  await page.locator('#playerConfirm').click({ timeout: 1000 });

  await expect(page.locator('#playerList .player-row')).toHaveCount(24, { timeout: 2000 });
  await page.locator('#generateBtn').click({ timeout: 1000 });
  await expect(page.locator('#setupStatus')).toContainText('Rotation ready', { timeout: 5000 });

  await page.evaluate(() => {
    window.__crgPostGenerateClicks = 0;
    document.querySelector('[data-view="liveView"]')?.addEventListener('click', () => {
      window.__crgPostGenerateClicks += 1;
    });
  });

  await page.waitForTimeout(2000);
  await page.locator('[data-view="liveView"]').click({ timeout: 1000 });
  await expect.poll(() => page.evaluate(() => window.__crgPostGenerateClicks)).toBe(1);
});
