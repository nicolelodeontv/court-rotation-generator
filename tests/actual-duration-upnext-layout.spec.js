const { test, expect } = require('@playwright/test');

const roster = count => Array.from({ length: count }, (_, i) => `Player ${i + 1}`).join('\n');

async function generateSession(page, playerCount, expectedGames) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(playerCount));
  await page.locator('#playerConfirm').click();
  await expect(page.locator('#playerList .player-row')).toHaveCount(playerCount, { timeout: 2000 });
  await page.locator('#generateBtn').click();
  await expect(page.locator('#setupStatus')).toContainText('Rotation ready', { timeout: 5000 });
  await expect(page.locator('.game-match')).toHaveCount(expectedGames, { timeout: 5000 });
}

async function completeCurrentGame(page, waitMs = 0) {
  if (waitMs) await page.waitForTimeout(waitMs);
  await page.locator('#completeBtn').click();
  await expect(page.locator('[data-winner="0"]')).toBeVisible();
  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
}

async function assertUpNextPlayerNamesVisible(page) {
  const names = page.locator('#upNextList .crg-team-player-name');
  expect(await names.count()).toBeGreaterThan(0);
  await expect(names.first()).toBeVisible();
  for (const n of await names.all()) {
    const box = await n.boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThan(0);
  }
}

function formatDuration(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds));
  const display = total < 10 ? Number(total.toFixed(1)) : Math.round(total);
  if (display < 60) return display + ' sec';
  const minutes = Math.floor(display / 60);
  const seconds = display % 60;
  if (minutes < 60) return seconds ? minutes + ' min ' + seconds + ' sec' : minutes + ' min';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours + ' hr' + (remainingMinutes ? ' ' + remainingMinutes + ' min' : '');
}

function encodeHash(payload) {
  const text = JSON.stringify(payload);
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}

test('Feature 26 shows four upcoming games and keeps total remaining count accurate', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await generateSession(page, 10, 15);

  await expect(page.locator('#upNextList .next-item')).toHaveCount(4);
  await assertUpNextPlayerNamesVisible(page);
  await expect(page.locator('#upNextList .next-item > span:first-child').allTextContents()).resolves.toEqual([
    'Game 2', 'Game 3', 'Game 4', 'Game 5'
  ]);
  await expect(page.locator('#remaining')).toHaveText('14 remaining');

  const alignment = await page.evaluate(() => {
    const panel = document.querySelector('#liveView .live-upnext-column > .upnext')?.getBoundingClientRect();
    const copy = document.querySelector('#copyLiveSpectatorBtn')?.getBoundingClientRect();
    const cards = [...document.querySelectorAll('#upNextList .next-item')].map(node => node.getBoundingClientRect());
    return {
      panelBottom: panel?.bottom || 0,
      copyBottom: copy?.bottom || 0,
      cardCount: cards.length,
      lastCardBottom: cards.at(-1)?.bottom || 0,
      listBottom: document.querySelector('#upNextList')?.getBoundingClientRect().bottom || 0,
    };
  });
  expect(alignment.cardCount).toBe(4);
  expect(Math.abs(alignment.panelBottom - alignment.lastCardBottom)).toBeLessThanOrEqual(10);
  expect(alignment.lastCardBottom).toBeLessThanOrEqual(alignment.listBottom + 1);

  await completeCurrentGame(page);
  await expect(page.locator('#currentNo')).toHaveText('GAME 2');
  await expect(page.locator('#upNextList .next-item')).toHaveCount(4);
  await assertUpNextPlayerNamesVisible(page);
  await expect(page.locator('#upNextList .next-item > span:first-child').allTextContents()).resolves.toEqual([
    'Game 3', 'Game 4', 'Game 5', 'Game 6'
  ]);
  await expect(page.locator('#remaining')).toHaveText('13 remaining');
});

test('Actual timer durations feed Session complete sharing and never fall back to stale values', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await generateSession(page, 4, 3);

  // Three real elapsed intervals create real timer records without making the regression test slow.
  await completeCurrentGame(page, 1200);
  await completeCurrentGame(page, 1200);
  await completeCurrentGame(page, 1200);

  await expect(page.locator('.sheet.final-rankings')).toBeVisible();

  // The Session complete modal should not reintroduce the removed stale timing stats.
  const modalText = await page.locator('.sheet.final-rankings').innerText();
  expect(modalText).not.toContain('Game duration');
  expect(modalText).not.toContain('Estimated session time');

  const durationData = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('crg-live-state-v1'));
    const values = d.games.map((_, i) => Number.isFinite(Number(d.gameDurations?.[i])) ? Math.max(0, Math.floor(Number(d.gameDurations[i]))) : null);
    const recorded = values.filter(value => value !== null);
    const total = recorded.reduce((sum, value) => sum + value, 0);
    return {
      recorded,
      total,
      average: recorded.length ? total / recorded.length : null,
    };
  });
  expect(durationData.recorded).toHaveLength(3);
  expect(durationData.total).toBeGreaterThanOrEqual(3);
  expect(durationData.average).toBeGreaterThanOrEqual(1);

  await page.locator('#finalShareBtn').click();
  await expect(page.locator('.sheet.final-share')).toBeVisible();
  const link = await page.locator('#finalResultsLink').inputValue();
  expect(link).toMatch(/#results=[A-Za-z0-9_-]+$/);

  const payload = await page.evaluate(encoded => {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const binary = atob(normalized);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
  }, link.split('#results=')[1]);

  expect(payload.v).toBe(2);
  expect(payload.d).toBeUndefined();
  expect(payload.t).toEqual(durationData.recorded);

  const shared = await page.context().newPage();
  await shared.goto(link);
  await shared.waitForLoadState('domcontentloaded');
  await expect(shared.locator('.shared-results-page')).toBeVisible();

  const summary = shared.locator('.shared-results-summary');
  await expect(summary.locator('div').nth(0)).toContainText('Games played');
  await expect(summary.locator('div').nth(0)).toContainText('3');
  await expect(summary.locator('div').nth(1)).toContainText('Players');
  await expect(summary.locator('div').nth(1)).toContainText('4');
  await expect(summary.locator('div').nth(2)).toContainText('Courts');
  await expect(summary.locator('div').nth(2)).toContainText('1');

  const avgText = await summary.locator('div').nth(3).innerText();
  const totalText = await summary.locator('div').nth(4).innerText();
  expect(avgText).toContain('Avg. game duration');
  expect(avgText).toContain(formatDuration(durationData.average));
  expect(totalText).toContain('Total session time');
  expect(totalText).toContain(formatDuration(durationData.total));
  expect(avgText).not.toContain('15 min');
  expect(totalText).not.toContain('225 min');
  await shared.close();

  await page.locator('#finalResultsCloseBtn').click();
  await expect(page.locator('.sheet.final-rankings')).toBeVisible();
  await page.locator('#completeCloseBtn').click();
  await page.locator('[data-view="moreView"]').click();
  await expect(page.locator('#summary')).toContainText('Games');
  const sessionSummaryText = await page.locator('#summary').innerText();
  expect(sessionSummaryText).not.toContain('Game duration');
  expect(sessionSummaryText).not.toContain('Estimated session time');
});

test('Legacy shared result links show unavailable timing instead of fabricated 15/225-minute values', async ({ page }) => {
  const legacy = {
    v: 1,
    g: 3,
    p: 4,
    c: 1,
    d: 15,
    r: [
      { n: 'Player 1', w: 2, l: 1, g: 3 },
      { n: 'Player 2', w: 1, l: 2, g: 3 },
      { n: 'Player 3', w: 1, l: 2, g: 3 },
      { n: 'Player 4', w: 1, l: 2, g: 3 }
    ]
  };
  await page.goto('/#results=' + encodeHash(legacy));
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.shared-results-page')).toBeVisible();

  const summaryText = await page.locator('.shared-results-summary').innerText();
  expect(summaryText).toContain('Avg. game duration');
  expect(summaryText).toContain('—');
  expect(summaryText).toContain('Total session time');
  expect(summaryText).not.toContain('15 min');
  expect(summaryText).not.toContain('225 min');
});

test('More right column stacks Session summary and Reset session with normal spacing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('[data-view="moreView"]').click();
  await expect(page.locator('#moreView')).toHaveClass(/active/);

  const layout = await page.evaluate(() => {
    const session = document.querySelector('#moreView .tools-grid > .card');
    const right = document.querySelector('#moreView .tools-right-column');
    const summary = document.querySelector('#moreView .summary-card');
    const reset = document.querySelector('#moreView .session-reset-card');
    const sessionRect = session?.getBoundingClientRect();
    const rightRect = right?.getBoundingClientRect();
    const summaryRect = summary?.getBoundingClientRect();
    const resetRect = reset?.getBoundingClientRect();
    return {
      sessionBottom: sessionRect?.bottom || 0,
      summaryTop: summaryRect?.top || 0,
      summaryBottom: summaryRect?.bottom || 0,
      resetTop: resetRect?.top || 0,
      resetBottom: resetRect?.bottom || 0,
      rightBottom: rightRect?.bottom || 0,
      gap: resetRect && summaryRect ? resetRect.top - summaryRect.bottom : 0,
      rightColumnDisplay: right ? getComputedStyle(right).display : '',
      rightColumnDirection: right ? getComputedStyle(right).flexDirection : '',
    };
  });

  expect(layout.sessionBottom).toBeGreaterThan(layout.summaryTop);
  expect(layout.resetTop).toBeGreaterThanOrEqual(layout.summaryBottom);
  expect(layout.gap).toBeGreaterThanOrEqual(0);
  expect(layout.gap).toBeLessThanOrEqual(24);
  expect(layout.rightColumnDisplay).toBe('flex');
  expect(layout.rightColumnDirection).toBe('column');
  expect(layout.rightBottom).toBeCloseTo(layout.resetBottom, 0);
});

test('Up Next player names stay visible in two-court and narrow-phone layouts', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('crg-live-state-v1');
    localStorage.removeItem('crg-setup-nav-hidden-v1');
  });

  const cases = [
    { width: 1280, height: 900, courts: 2, expectedGames: 15 },
    { width: 390, height: 844, courts: 1, expectedGames: 15 },
  ];

  for (const { width, height, courts, expectedGames } of cases) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#courts').fill(String(courts));
    await page.locator('#playerPasteBtn').click();
    await page.locator('#pastePlayerNames').fill(roster(10));
    await page.locator('#playerConfirm').click();
    await page.locator('#generateBtn').click();
    await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });
    await expect(page.locator('.game-match')).toHaveCount(expectedGames, { timeout: 5000 });
    await assertUpNextPlayerNamesVisible(page);
  }
});
