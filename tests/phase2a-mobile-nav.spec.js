const { test, expect } = require('@playwright/test');

const roster = count => Array.from({ length: count }, (_, i) => `Player ${i + 1}`).join('\n');

async function generateSession(page, playerCount) {
  await page.locator('#names').fill(roster(playerCount));
  await page.locator('#generateBtn').click();
  await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });
}

async function gotoMobile(page, width, height = 800) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
}

test('Mobile bottom nav is fixed with expected floating-pill geometry', async ({ page }) => {
  await gotoMobile(page, 700);

  const nav = page.locator('.bottom-nav');
  await expect(nav).toBeVisible();

  const style = await nav.evaluate(el => {
    const cs = getComputedStyle(el);
    return { position: cs.position, bottom: cs.bottom };
  });
  expect(style.position).toBe('fixed');
  expect(parseFloat(style.bottom)).toBeCloseTo(8, 0);

  const rect = await nav.evaluate(el => el.getBoundingClientRect());
  const viewport = page.viewportSize();
  expect(rect.left).toBeGreaterThanOrEqual(8);
  expect(viewport.width - rect.right).toBeGreaterThanOrEqual(8);
});

test('Nav reflows from 3 columns before generation to 5 after', async ({ page }) => {
  await gotoMobile(page, 700);

  const columnCount = async () => {
    const value = await page.locator('.bottom-nav').evaluate(
      el => getComputedStyle(el).gridTemplateColumns
    );
    return value.trim().split(/\s+/).length;
  };

  expect(await columnCount()).toBe(3);

  await generateSession(page, 6);

  expect(await columnCount()).toBe(5);
});

test('#setupNavBtn is genuinely hidden after generation, not just visually suppressed', async ({ page }) => {
  await gotoMobile(page, 700);
  await expect(page.locator('#setupNavBtn')).toBeVisible();

  await generateSession(page, 6);

  const setupBtn = page.locator('#setupNavBtn');
  await expect(setupBtn).toBeHidden();

  const state = await setupBtn.evaluate(el => ({
    hiddenAttr: el.hidden,
    display: getComputedStyle(el).display,
  }));
  expect(state.hiddenAttr).toBe(true);
  expect(state.display).toBe('none');
});

test('Sticky Live quick actions stay above the fixed nav', async ({ page }) => {
  await gotoMobile(page, 700);
  await generateSession(page, 6);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  const quickRect = await page.locator('#liveView .live-card > .quick').evaluate(
    el => el.getBoundingClientRect()
  );
  const navRect = await page.locator('.bottom-nav').evaluate(
    el => el.getBoundingClientRect()
  );

  expect(quickRect.bottom).toBeLessThanOrEqual(navRect.top + 1);
});

test('Narrow ≤359px viewport uses the tighter clearance than ≤700px', async ({ page }) => {
  await gotoMobile(page, 359);

  const clearanceBefore = await page.evaluate(
    () => getComputedStyle(document.body).getPropertyValue('--bottom-nav-clearance').trim()
  );
  expect(clearanceBefore).toBe('109px');

  await generateSession(page, 6);

  const clearanceAfter = await page.evaluate(
    () => getComputedStyle(document.body).getPropertyValue('--bottom-nav-clearance').trim()
  );
  expect(clearanceAfter).toBe('63px');
});

test('At 700px the clearance uses the standard values, not the narrow-phone ones', async ({ page }) => {
  await gotoMobile(page, 400);

  const clearanceBefore = await page.evaluate(
    () => getComputedStyle(document.body).getPropertyValue('--bottom-nav-clearance').trim()
  );
  expect(clearanceBefore).toBe('117px');

  await generateSession(page, 6);

  const clearanceAfter = await page.evaluate(
    () => getComputedStyle(document.body).getPropertyValue('--bottom-nav-clearance').trim()
  );
  expect(clearanceAfter).toBe('66px');
});
