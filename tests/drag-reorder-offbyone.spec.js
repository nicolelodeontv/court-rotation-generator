const { test, expect } = require('@playwright/test');

const ROSTER = ['Alice', 'Bob', 'Cara', 'Dana', 'Eli'];

async function generateSession(page) {
  await page.route('**/api/live-config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ configured: false, url: '', publishableKey: '', source: 'test' }),
  }));
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(ROSTER.join('\n'));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('#scheduleList .game-row')).toHaveCount(5, { timeout: 5000 });
  await expect(page.locator('#upNextList .next-item[data-upcoming-index]')).toHaveCount(4);

  // This regression isolates client-side reorder behavior from the legacy live-sync backend.
  await page.evaluate(() => {
    window.CRG_LIVE_SYNC_TOUCH = () => {};
  });
}

async function scheduleMatches(page) {
  await page.waitForTimeout(50);
  return page.locator('#scheduleList .game-row .game-match').allTextContents();
}

async function snapshotMatches(page) {
  return page.evaluate(() =>
    (window.CRG_GET_LIVE_SNAPSHOT?.().schedule || []).map(game =>
      game.teams
        .map(team => team.map(player => player.name).join(' + '))
        .join(' VS ')
    )
  );
}

async function dragGame(page, sourceIndex, targetIndex, { move = true } = {}) {
  const source = page.locator(
    '#upNextList .next-item[data-upcoming-index="' + sourceIndex + '"]'
  );
  const target = page.locator(
    '#upNextList .next-item[data-upcoming-index="' + targetIndex + '"]'
  );
  const sourceRect = await source.boundingBox();
  const targetRect = await target.boundingBox();

  if (!sourceRect || !targetRect) {
    throw new Error('Could not measure Up Next drag targets');
  }

  await page.mouse.move(
    sourceRect.x + sourceRect.width / 2,
    sourceRect.y + sourceRect.height / 2
  );
  await page.mouse.down();

  // Drop in the upper half so the placeholder occupies the target's original slot.
  if (move) {
    await page.mouse.move(
      targetRect.x + targetRect.width / 2,
      targetRect.y + 6,
      { steps: 8 }
    );
  }

  await expect(page.locator('.upnext-dragging-card')).toHaveCount(1);
  console.log(JSON.stringify(await page.evaluate(() => ({
    list: [...document.querySelector('#upNextList').children].map(node => ({
      tag: node.tagName,
      game: node.dataset?.upcomingIndex || null,
      placeholder: node.classList.contains('upnext-drag-placeholder'),
      rect: (() => {
        const r = node.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
      })(),
    })),
  })));
  await page.mouse.up();

  await expect(page.locator('.upnext-dragging-card')).toHaveCount(0);
  await expect(page.locator('.upnext-drag-placeholder')).toHaveCount(0);
  await expect(page.locator('#upNextReorderStatus')).toContainText('Moved Game');
}

async function assertMovedToTarget(page, sourceGameNumber, targetGameNumber) {
  const before = await scheduleMatches(page);
  const beforeSnapshot = await snapshotMatches(page);
  await dragGame(page, sourceGameNumber - 1, targetGameNumber - 1);
  const after = await scheduleMatches(page);
  const afterSnapshot = await snapshotMatches(page);

  const expectedMatch = before[sourceGameNumber - 1];
  const actualPosition = after.findIndex(match => match === expectedMatch) + 1;

  console.log(JSON.stringify({
    sourceGame: sourceGameNumber,
    targetGame: targetGameNumber,
    expectedPosition: targetGameNumber,
    actualPosition,
    beforeOrder: before,
    afterOrder: after,
    beforeSnapshot,
    afterSnapshot,
  }));

  expect(actualPosition).toBe(targetGameNumber);
  expect(after[targetGameNumber - 1]).toBe(expectedMatch);
}

test('drag Game 2 onto Game 4 lands in Game 4 position', async ({ page }) => {
  await generateSession(page);
  await assertMovedToTarget(page, 2, 4);
  await expect(page.locator('#upNextReorderStatus')).toHaveText('Moved Game 2 to Game 4.');
});

test('drag Game 4 up onto Game 2 lands in Game 2 position', async ({ page }) => {
  await generateSession(page);
  await assertMovedToTarget(page, 4, 2);
  await expect(page.locator('#upNextReorderStatus')).toHaveText('Moved Game 4 to Game 2.');
});

test('drag first upcoming game to the last upcoming position', async ({ page }) => {
  await generateSession(page);
  await assertMovedToTarget(page, 2, 5);
  await expect(page.locator('#upNextReorderStatus')).toHaveText('Moved Game 2 to Game 5.');
});

test('drag last upcoming game to the first upcoming position', async ({ page }) => {
  await generateSession(page);
  await assertMovedToTarget(page, 5, 2);
  await expect(page.locator('#upNextReorderStatus')).toHaveText('Moved Game 5 to Game 2.');
});

test('dropping a game on itself leaves the order unchanged', async ({ page }) => {
  await generateSession(page);

  const before = await scheduleMatches(page);
  await dragGame(page, 3 - 1, 3 - 1, { move: false });
  const after = await scheduleMatches(page);

  console.log(JSON.stringify({
    sourceGame: 3,
    targetGame: 3,
    expectedPosition: 3,
    actualPosition: after.findIndex(match => match === before[2]) + 1,
    beforeOrder: before,
    afterOrder: after,
  }));

  expect(after).toEqual(before);
  await expect(page.locator('#upNextReorderStatus')).toHaveText('Moved Game 3 to Game 3.');
});
