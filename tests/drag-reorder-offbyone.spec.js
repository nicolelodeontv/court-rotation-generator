const { test, expect } = require('@playwright/test');

const ROSTER = ['Alice', 'Bob', 'Cara', 'Dana', 'Eli'];

async function generateSession(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(ROSTER.join('\n'));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('#scheduleList .game-row')).toHaveCount(5, { timeout: 5000 });
  await expect(page.locator('#upNextList .next-item[data-upcoming-index]')).toHaveCount(4);
}

async function scheduleMatches(page) {
  return page.locator('#scheduleList .game-row .game-match').allTextContents();
}

async function dragGame2OntoGame4(page) {
  const source = page.locator('#upNextList .next-item[data-upcoming-index="1"]');
  const target = page.locator('#upNextList .next-item[data-upcoming-index="3"]');
  const sourceRect = await source.boundingBox();
  const targetRect = await target.boundingBox();
  if (!sourceRect || !targetRect) throw new Error('Could not measure Up Next drag targets');

  await page.mouse.move(sourceRect.x + sourceRect.width / 2, sourceRect.y + sourceRect.height / 2);
  await page.mouse.down();
  // Upper half of Game 4 makes the placeholder occupy Game 4's original position.
  await page.mouse.move(
    targetRect.x + targetRect.width / 2,
    targetRect.y + 6,
    { steps: 8 }
  );
  await expect(page.locator('.upnext-dragging-card')).toHaveCount(1);
  await page.mouse.up();

  await expect(page.locator('.upnext-dragging-card')).toHaveCount(0);
  await expect(page.locator('.upnext-drag-placeholder')).toHaveCount(0);
}

test('diagnose downward reorder off-by-one: Game 2 onto Game 4', async ({ page }) => {
  await generateSession(page);

  const before = await scheduleMatches(page);
  await dragGame2OntoGame4(page);
  const after = await scheduleMatches(page);

  const expectedGame4Match = before[1];
  const actualPosition = after.findIndex(match => match === expectedGame4Match) + 1;

  console.log(JSON.stringify({
    expectedGame4Position: 4,
    actualGame2Position: actualPosition,
    beforeOrder: before.map((match, i) => ({ position: i + 1, match })),
    afterOrder: after.map((match, i) => ({ position: i + 1, match })),
  }));

  expect(
    after[3],
    'Game 2 should occupy Game 4\'s original schedule position'
  ).toBe(expectedGame4Match);
  expect(actualPosition).toBe(4);
});
