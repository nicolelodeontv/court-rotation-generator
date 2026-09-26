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
  for (let i = 0; i < 8; i++) await page.locator('#nextBtn').click({ force: true });
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


test('Live uses two columns on desktop, stacks on mobile, and rankings stay single-row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(8));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(12, { timeout: 5000 });

  const desktopLayout = await page.evaluate(() => {
    const grid = document.querySelector('#liveView .live-grid');
    const left = document.querySelector('#liveView .live-main-column');
    const right = document.querySelector('#liveView .live-upnext-column');
    const log = document.querySelector('#liveView .match-log');
    const style = grid ? getComputedStyle(grid) : null;
    const lr = left?.getBoundingClientRect();
    const rr = right?.getBoundingClientRect();
    const mr = log?.getBoundingClientRect();
    return {
      display: style?.display,
      columns: style?.gridTemplateColumns,
      leftRight: lr?.right,
      rightLeft: rr?.left,
      logTop: mr?.top,
      columnBottom: Math.max(lr?.bottom || 0, rr?.bottom || 0),
    };
  });
  expect(desktopLayout.display).toBe('grid');
  expect(desktopLayout.columns).toContain(' ');
  expect(desktopLayout.leftRight).toBeLessThanOrEqual(desktopLayout.rightLeft);
  expect(desktopLayout.logTop).toBeGreaterThanOrEqual(desktopLayout.columnBottom);

  await page.setViewportSize({ width: 600, height: 900 });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('#liveView .live-grid')).display)).toBe('block');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('[data-view="scheduleView"]').click();
  const schedule = await page.evaluate(() => ({
    stars: document.querySelectorAll('.game-row .schedule-player-stars').length,
    labels: [...document.querySelectorAll('.game-row .game-team-label')].slice(0, 2).map(node => node.textContent),
    firstMatch: document.querySelector('.game-row .game-match')?.innerText || '',
  }));
  expect(schedule.stars).toBe(48);
  expect(schedule.labels[0]).toMatch(/^TEAM A \(\d+★\)$/);
  expect(schedule.labels[1]).toMatch(/^TEAM B \(\d+★\)$/);
  expect(schedule.firstMatch).toMatch(/⭐/);

  await page.locator('[data-view="liveView"]').click();
  for (let i = 0; i < 12; i++) {
    await page.locator('#completeBtn').click();
    await page.locator('[data-winner="0"]').click();
  }
  await expect(page.locator('.sheet.final-rankings')).toBeVisible();
  const finalRows = await page.locator('.complete-rank-row').evaluateAll(rows => rows.map(row => {
    const style = getComputedStyle(row);
    const identity = row.querySelector('.complete-identity');
    const place = row.querySelector('.complete-place');
    const name = row.querySelector('.complete-name');
    const stats = row.querySelector('.complete-stats');
    return {
      display: style.display,
      flexWrap: style.flexWrap,
      rowTop: row.getBoundingClientRect().top,
      identityTop: identity?.getBoundingClientRect().top,
      placeTop: place?.getBoundingClientRect().top,
      nameTop: name?.getBoundingClientRect().top,
      statsTop: stats?.getBoundingClientRect().top,
      chips: stats ? stats.querySelectorAll('span').length : 0,
    };
  }));
  expect(finalRows).toHaveLength(8);
  expect(finalRows.every(row => row.display === 'flex')).toBeTruthy();
  expect(finalRows.every(row => row.flexWrap === 'nowrap')).toBeTruthy();
  expect(finalRows.every(row => Math.abs(row.identityTop - row.rowTop) < 3)).toBeTruthy();
  expect(finalRows.every(row => Math.abs(row.placeTop - row.nameTop) < 3)).toBeTruthy();
  expect(finalRows.every(row => Math.abs(row.statsTop - row.rowTop) < 3)).toBeTruthy();
  expect(finalRows.every(row => row.chips === 4)).toBeTruthy();
  await page.screenshot({ path: 'test-results/rankings-modal-single-row.png', fullPage: true });

  await page.locator('#completeCloseBtn').click();
  await page.locator('[data-view="rankingsView"]').click();
  await expect(page.locator('.rank-row').first()).toBeVisible();
  const rankRowStyle = await page.locator('.rank-row').first().evaluate(row => ({
    display: getComputedStyle(row).display,
    identityDisplay: getComputedStyle(row.querySelector('.rank-identity')).display,
    chips: row.querySelectorAll('.rank-stats .rank-chip').length,
    placementTop: row.querySelector('.rank-pos')?.getBoundingClientRect().top,
    nameTop: row.querySelector('.rank-name')?.getBoundingClientRect().top,
  }));
  expect(rankRowStyle.display).toBe('flex');
  expect(rankRowStyle.identityDisplay).toBe('flex');
  expect(rankRowStyle.chips).toBe(4);
  expect(Math.abs(rankRowStyle.placementTop - rankRowStyle.nameTop)).toBeLessThan(3);
});


test('winner row inversion, player stars, singular games label, and setup nav visibility', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#setupNavBtn')).toBeVisible();
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(4));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(1, { timeout: 5000 });

  await expect(page.locator('#setupNavBtn')).toBeHidden();
  await expect(page.locator('[data-view="liveView"]')).toHaveClass(/active/);
  await expect(page.locator('.bottom-nav .nav-btn')).toHaveCount(5);
  await expect(page.locator('.bottom-nav')).toHaveCSS('grid-template-columns', /repeat\(5,/);

  await page.locator('[data-view="moreView"]').click();
  await page.locator('#manageSessionBtn').click();
  await expect(page.locator('#setupView')).toHaveClass(/active/);
  await expect(page.locator('#setupView .grid-setup')).toBeVisible();
  await expect(page.locator('#setupSummary')).toHaveCount(0);

  await page.locator('#games').fill('1');
  await expect(page.locator('#setupView .grid-setup')).toBeVisible();

  await page.locator('[data-view="playersView"]').click();
  const playerCard = page.locator('.player-card').first();
  await expect(playerCard.locator('.player-name-rating')).toBeVisible();
  await expect(playerCard.locator('.player-skill-stars')).toHaveText(/⭐{1,6}/);
  await expect(playerCard.locator('.stat-chip').first()).toContainText('1 game');

  await page.locator('[data-view="liveView"]').click();
  await page.locator('#completeBtn').click();
  await page.locator('[data-winner="0"]').click();
  await expect(page.locator('.sheet.final-rankings')).toBeVisible();

  const firstModal = page.locator('.complete-rank-row').first();
  await expect(firstModal).toHaveClass(/first-place/);
  const modalStyles = await firstModal.evaluate(row => {
    const rowStyle = getComputedStyle(row);
    const chips = [...row.querySelectorAll('.complete-stats > span')].map(node => getComputedStyle(node));
    return {
      background: rowStyle.backgroundColor,
      color: getComputedStyle(row.querySelector('.complete-name')).color,
      chipBackgrounds: chips.map(style => style.backgroundColor),
      chipColors: chips.map(style => style.color),
      gameChip: row.querySelector('.complete-games-played')?.textContent || '',
      display: rowStyle.display,
      wrap: rowStyle.flexWrap,
    };
  });
  expect(modalStyles.background).toBe('rgb(184, 166, 123)');
  expect(modalStyles.color).toBe('rgb(42, 51, 40)');
  expect(modalStyles.chipBackgrounds.every(value => value === 'rgb(42, 51, 40)')).toBeTruthy();
  expect(modalStyles.chipColors.every(value => value === 'rgb(239, 234, 221)')).toBeTruthy();
  expect(modalStyles.gameChip).toBe('1 game');
  expect(modalStyles.display).toBe('flex');
  expect(modalStyles.wrap).toBe('nowrap');

  await page.locator('#completeCloseBtn').click();
  await page.locator('[data-view="rankingsView"]').click();
  const firstRanksRow = page.locator('.rank-row').first();
  await expect(firstRanksRow).toHaveClass(/first-place/);
  await expect(firstRanksRow.locator('.rank-stats .rank-chip').nth(2)).toHaveText('1 game');

  const ranksStyles = await firstRanksRow.evaluate(row => ({
    background: getComputedStyle(row).backgroundColor,
    text: getComputedStyle(row.querySelector('.rank-name')).color,
    chipBackground: getComputedStyle(row.querySelector('.rank-chip')).backgroundColor,
    chipText: getComputedStyle(row.querySelector('.rank-chip')).color,
  }));
  expect(ranksStyles.background).toBe('rgb(184, 166, 123)');
  expect(ranksStyles.text).toBe('rgb(42, 51, 40)');
  expect(ranksStyles.chipBackground).toBe('rgb(42, 51, 40)');
  expect(ranksStyles.chipText).toBe('rgb(239, 234, 221)');

  await page.reload();
  await expect(page.locator('#setupNavBtn')).toBeHidden();
  await expect(page.locator('.bottom-nav .nav-btn')).toHaveCount(5);

  await page.locator('[data-view="moreView"]').click();
  await page.locator('#manageSessionBtn').click();
  await page.locator('#clearAllPlayersBtn').click();
  await expect(page.locator('#setupNavBtn')).toBeVisible();
  await expect(page.locator('.bottom-nav .nav-btn')).toHaveCount(6);
  await expect(page.locator('#setupView')).toHaveClass(/active/);
  await expect(page.locator('#scheduleList .game-row')).toHaveCount(0);
});

