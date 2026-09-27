const { test, expect } = require('@playwright/test');

const roster = Array.from({ length: 10 }, (_, i) => `Player ${i + 1}`).join('\n');

async function setupSession(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster);
  await page.locator('#playerConfirm').click();
  await expect(page.locator('#playerList .player-row')).toHaveCount(10);
  await page.locator('#generateBtn').click();
  await expect(page.locator('#setupStatus')).toContainText('Rotation ready', { timeout: 5000 });
  await expect(page.locator('#liveView')).toHaveClass(/active/);
  await expect(page.locator('#progressText')).toHaveText('0 / 15 games');
}

async function currentPlayerNames(page) {
  return (await page.locator('#currentTeams .live-player-name').allTextContents()).map(v => v.trim());
}

test.describe('session persistence across refresh', () => {
  test('fresh state stays on Setup and never renders Session Complete', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#setupView')).toHaveClass(/active/);
    await expect(page.locator('#liveView')).not.toHaveClass(/active/);
    await expect(page.locator('#progressText')).toHaveText('0 / 0 games');
    await expect(page.locator('#currentNo')).toHaveText('GAME —');
    await expect(page.locator('#currentNo')).not.toContainText('SESSION COMPLETE');
    await expect(page.locator('#liveStatus')).toHaveText('READY');
  });

  test('generated 0/15 session restores the exact current game and Up next after refresh', async ({ page }) => {
    await setupSession(page);
    const before = {
      current: await currentPlayerNames(page),
      upNext: (await page.locator('#upNextList').innerText()).replace(/\s+/g, ' ').trim(),
      sticky: await page.locator('#stickyGame').innerText()
    };
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('crg-session-v4') || 'null'));
    expect(saved?.version).toBe(6);
    expect(saved?.phase).toBe('in-progress');
    expect(saved?.games).toHaveLength(15);
    expect(saved?.done).toEqual([]);
    expect(saved?.matchLog).toEqual([]);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#liveView')).toHaveClass(/active/);
    await expect(page.locator('#currentNo')).toHaveText('GAME 1');
    await expect(page.locator('#progressText')).toHaveText('0 / 15 games');
    await expect.poll(() => currentPlayerNames(page)).toEqual(before.current);
    await expect.poll(() => page.locator('#upNextList').innerText()).toHaveText(before.upNext);
    await expect(page.locator('#stickyGame')).toHaveText(before.sticky);
    await expect(page.locator('#liveStatus')).toHaveText('NEXT UP');
    await expect(page.locator('#currentNo')).not.toContainText('SESSION COMPLETE');
  });

  test('five completed games restore as Game 6 with match results after refresh', async ({ page }) => {
    await setupSession(page);
    for (let i = 0; i < 5; i++) {
      await page.locator(`#scheduleList [data-result="${i}"]`).click();
      await page.locator('#sheetContent [data-winner="0"]').click();
      await expect(page.locator('#progressText')).toHaveText(`${i + 1} / 15 games`);
    }
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('crg-session-v4') || 'null'));
    expect(saved?.phase).toBe('in-progress');
    expect(saved?.done).toEqual([0, 1, 2, 3, 4]);
    expect(Object.keys(saved?.results || {})).toHaveLength(5);
    expect(saved?.matchLog).toHaveLength(5);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#liveView')).toHaveClass(/active/);
    await expect(page.locator('#currentNo')).toHaveText('GAME 6');
    await expect(page.locator('#progressText')).toHaveText('5 / 15 games');
    await expect(page.locator('#progressPct')).toHaveText('33%');
    await expect(page.locator('#liveStatus')).toHaveText('NEXT UP');
    await expect(page.locator('#scheduleList .game-row.done')).toHaveCount(5);
    await expect(page.locator('#rankingsList .rank-row').first()).toContainText('W');
  });

  test('all 15 games completed restore as Session Complete after refresh', async ({ page }) => {
    await setupSession(page);
    for (let i = 0; i < 15; i++) {
      await page.locator(`#scheduleList [data-result="${i}"]`).click();
      await page.locator('#sheetContent [data-winner="0"]').click();
    }
    await expect(page.locator('#progressText')).toHaveText('15 / 15 games');
    await expect(page.locator('#currentNo')).toHaveText('✓ SESSION COMPLETE');
    await expect(page.locator('#liveStatus')).toHaveText('COMPLETE');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('crg-session-v4') || 'null'));
    expect(saved?.phase).toBe('complete');
    expect(saved?.done).toHaveLength(15);
    expect(saved?.matchLog).toHaveLength(15);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#liveView')).toHaveClass(/active/);
    await expect(page.locator('#currentNo')).toHaveText('✓ SESSION COMPLETE');
    await expect(page.locator('#progressText')).toHaveText('15 / 15 games');
    await expect(page.locator('#liveStatus')).toHaveText('COMPLETE');
    await expect(page.locator('#currentNo')).not.toHaveText('GAME —');
  });
});
