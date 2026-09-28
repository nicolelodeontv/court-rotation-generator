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
  await expect(page.locator('#stickyLive')).toHaveCount(0);
  await expect(page.locator('#liveView .live-card')).toBeVisible();
  await expect(page.locator('#progressText')).toHaveText(`0 / ${totalGames} games`);

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
  const actual = (await currentNames.allTextContents()).map(s => s.replace(/\s+⭐+.*$/, '').trim());
  expect(actual).toEqual(expectedNames);

  const scheduleNames = spectator.locator('.spectator-game .spectator-player-name');
  expect(await scheduleNames.count()).toBeGreaterThanOrEqual(expectedNames.length);
  for (const name of expectedNames) {
    await expect(spectator.locator('.spectator-current .spectator-player-name').filter({ hasText: name }).first()).toBeVisible();
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


test('Up Next free reorder moves the whole generated game without validation blocking', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(5));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(5, { timeout: 5000 });

  await expect(page.locator('.upnext-swap')).toHaveCount(0);
  await expect(page.locator('[data-swap-game]')).toHaveCount(0);
  await expect(page.locator('#upNextList .drag-handle')).toHaveCount(4);

  const source = page.locator('#upNextList .next-item[data-upcoming-index="1"]');
  const target = page.locator('#upNextList .next-item[data-upcoming-index="3"]');
  const sourceRect = await source.boundingBox();
  const targetRect = await target.boundingBox();
  if (!sourceRect || !targetRect) throw new Error('Could not measure Up Next drag targets');

  const before = await page.evaluate(() => {
    const row = document.querySelector('#scheduleList .game-row:nth-child(2)');
    return {
      match: row?.querySelector('.game-match')?.textContent.replace(/⭐/g, '').replace(/\s+/g, ' ').trim() || '',
      labels: [...(row?.querySelectorAll('.game-team-label') || [])].map(node => node.textContent || ''),
    };
  });

  await page.mouse.move(sourceRect.x + sourceRect.width / 2, sourceRect.y + sourceRect.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetRect.x + targetRect.width / 2, targetRect.y + targetRect.height - 4, { steps: 8 });

  await expect.poll(() => page.locator('.upnext-dragging-card').count()).toBe(1);
  const dragState = await page.locator('.upnext-dragging-card').evaluate(card => {
    const list = document.querySelector('#upNextList');
    const cr = card.getBoundingClientRect();
    const lr = list?.getBoundingClientRect();
    return {
      parentId: card.parentElement?.id || '',
      position: getComputedStyle(card).position,
      leftInside: !!lr && cr.left >= lr.left - 8 && cr.right <= lr.right + 8,
      topInside: !!lr && cr.top >= lr.top - 8 && cr.bottom <= lr.bottom + 8,
      placeholder: !!list?.querySelector('.upnext-drag-placeholder'),
    };
  });
  expect(dragState.parentId).toBe('upNextList');
  expect(dragState.position).toBe('absolute');
  expect(dragState.leftInside).toBeTruthy();
  expect(dragState.topInside).toBeTruthy();
  expect(dragState.placeholder).toBeTruthy();

  await page.mouse.up();
  await expect(page.locator('.upnext-dragging-card')).toHaveCount(0);
  await expect(page.locator('.upnext-drag-placeholder')).toHaveCount(0);
  await expect(page.locator('#upNextList .next-item[data-upcoming-index]')).toHaveCount(4);
  await expect(page.locator('#upNextList .next-item > span:first-child')).toHaveText(['Game 2', 'Game 3', 'Game 4', 'Game 5']);

  const after = await page.evaluate(() => {
    const row = document.querySelector('#scheduleList .game-row:nth-child(4)');
    return {
      match: row?.querySelector('.game-match')?.textContent.replace(/⭐/g, '').replace(/\s+/g, ' ').trim() || '',
      labels: [...(row?.querySelectorAll('.game-team-label') || [])].map(node => node.textContent || ''),
      status: document.querySelector('#upNextReorderStatus')?.textContent || '',
    };
  });
  expect(after.match).toBe(before.match);
  expect(after.labels).toEqual(before.labels);
  expect(after.status).toContain('Moved Game 2 to Game 4.');
});

test('Up Next keyboard reorder and mobile handle drag path keep the queue usable', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(20));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(30, { timeout: 5000 });

  await page.locator('#upNextList .next-item[data-upcoming-index="2"]').focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#upNextList .next-item[data-upcoming-index="1"]')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });

  const card = page.locator('#upNextList .next-item[data-upcoming-index]').first();
  await expect(card).toBeVisible();

  const touchResult = await card.evaluate(async node => {
    const handle = node.querySelector('.drag-handle');
    if (!handle) throw new Error('missing drag handle');
    const rect = handle.getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 77,
      pointerType: 'touch',
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 77,
      pointerType: 'touch',
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2 + 24,
    }));
    const active = !!document.querySelector('.upnext-dragging-card');
    document.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true,
      pointerId: 77,
      pointerType: 'touch',
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2 + 24,
    }));
    return active;
  });
  expect(touchResult).toBeTruthy();
  await expect(page.locator('.upnext-dragging-card')).toHaveCount(0);
  await expect(page.locator('.upnext-drag-placeholder')).toHaveCount(0);
});

test('Match log team names stay on one compact flex row per team', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(8));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(12, { timeout: 5000 });

  await page.locator('#completeBtn').click();
  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
  await expect(page.locator('.match-log-entry')).toHaveCount(1);

  const teams = await page.locator('.match-log-entry .match-log-team').evaluateAll(nodes => nodes.map(node => {
    const block = node.querySelector('.live-team-block');
    const players = [...node.querySelectorAll('.live-player')];
    const and = node.querySelector('.live-and');
    const style = block ? getComputedStyle(block) : null;
    const tops = [...players, ...(and ? [and] : [])].map(el => el.getBoundingClientRect().top);
    return {
      display: style?.display,
      flexDirection: style?.flexDirection,
      alignItems: style?.alignItems,
      gap: style?.gap,
      playerCount: players.length,
      maxTopDelta: tops.length ? Math.max(...tops) - Math.min(...tops) : 0,
    };
  }));
  expect(teams).toHaveLength(2);
  for (const team of teams) {
    expect(team.display).toBe('flex');
    expect(team.flexDirection).toBe('row');
    expect(team.alignItems).toBe('center');
    expect(parseFloat(team.gap)).toBeGreaterThan(0);
    expect(team.playerCount).toBe(2);
    expect(team.maxTopDelta).toBeLessThan(5);
  }
  const logWinner = await page.locator('.match-log-team.match-log-winner .live-player-name').allTextContents();
  const logWinnerText = logWinner.map(name => name.replace(/\s*⭐+\s*$/, '').trim()).join(' and ');
  await expect(page.locator('.match-log-result')).toContainText(`Winner: ${logWinnerText}`);
  await expect(page.locator('.match-log-vs')).toHaveText('VS');
});

test('Players tab keeps vertical spacing between identity and stat chips on desktop and mobile', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(8));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(12, { timeout: 5000 });
  await page.locator('[data-view="playersView"]').click();

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const card = page.locator('.player-card').first();
    const spacing = await card.evaluate(node => {
      const head = node.querySelector('.player-card-head');
      const chips = node.querySelector('.player-meta');
      const headRect = head?.getBoundingClientRect();
      const chipsRect = chips?.getBoundingClientRect();
      return {
        marginBottom: getComputedStyle(head).marginBottom,
        gap: headRect && chipsRect ? chipsRect.top - headRect.bottom : 0,
      };
    });
    expect(spacing.marginBottom).toBe('12px');
    expect(spacing.gap).toBeGreaterThanOrEqual(12);
  }
});

test('Up Next width and fixed header navigation stay aligned', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(20));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(30, { timeout: 5000 });

  const bounds = await page.evaluate(() => {
    const panel = document.querySelector('#liveView .live-upnext-column > .upnext');
    const upList = document.querySelector('#upNextList');
    const grid = document.querySelector('#liveView .live-grid');
    const main = document.querySelector('#liveView .live-main-column');
    const app = document.querySelector('.app');
    const topbar = document.querySelector('.topbar');
    const nav = document.querySelector('.bottom-nav');
    const addPlayer = document.querySelector('#addMidSessionPlayerBtn');
    const courtMode = document.querySelector('#courtModeBtn');
    const panelRect = panel?.getBoundingClientRect();
    const listRect = upList?.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();
    const gridRect = grid?.getBoundingClientRect();
    const appRect = app?.getBoundingClientRect();
    const topbarRect = topbar?.getBoundingClientRect();
    const navRect = nav?.getBoundingClientRect();
    const navStyle = nav ? getComputedStyle(nav) : null;
    const addRect = addPlayer?.getBoundingClientRect();
    const courtRect = courtMode?.getBoundingClientRect();
    return {
      stickyCount: document.querySelectorAll('#stickyLive').length,
      panelTop: panelRect?.top || 0,
      panelBottom: panelRect?.bottom || 0,
      panelRight: panelRect?.right || 0,
      panelWidth: panelRect?.width || 0,
      listWidth: listRect?.width || 0,
      panelPaddingLeft: parseFloat(getComputedStyle(panel).paddingLeft) || 0,
      panelPaddingRight: parseFloat(getComputedStyle(panel).paddingRight) || 0,
      panelBorderLeft: parseFloat(getComputedStyle(panel).borderLeftWidth) || 0,
      panelBorderRight: parseFloat(getComputedStyle(panel).borderRightWidth) || 0,
      gridTop: gridRect?.top || 0,
      mainBottom: mainRect?.bottom || 0,
      appRight: appRect?.right || 0,
      topbarTop: topbarRect?.top || 0,
      navTop: navRect?.top || 0,
      navRight: navRect?.right || 0,
      navPosition: navStyle?.position || '',
      navBottomStyle: navStyle?.bottom || '',
      addVisible: !!addRect && addRect.width > 0 && addRect.height > 0,
      courtVisible: !!courtRect && courtRect.width > 0 && courtRect.height > 0,
    };
  });

  expect(bounds.stickyCount).toBe(0);
  expect(Math.abs(bounds.panelTop - bounds.gridTop)).toBeLessThanOrEqual(1);
  expect(bounds.panelBottom).toBeLessThanOrEqual(bounds.mainBottom + 1);
  const panelContentWidth = bounds.panelWidth - bounds.panelPaddingLeft - bounds.panelPaddingRight - bounds.panelBorderLeft - bounds.panelBorderRight;
  expect(Math.abs(panelContentWidth - bounds.listWidth)).toBeLessThanOrEqual(2);
  expect(bounds.navTop).toBeGreaterThanOrEqual(bounds.topbarTop);
  expect(await page.locator('.bottom-nav').evaluate(node => node.parentElement?.classList.contains('topbar'))).toBeTruthy();
  expect(bounds.navPosition).toBe('static');
  expect(bounds.navBottomStyle).toBe('auto');
  expect(await page.locator('.bottom-nav').evaluate(node => getComputedStyle(node).columnGap)).toBe('10px');
  expect(await page.locator('.bottom-nav').evaluate(node => node.parentElement?.classList.contains('topbar'))).toBeTruthy();
  await expect(page.locator('#scheduleList .game-label')).toHaveText(Array.from({ length: 30 }, (_, i) => `Game ${i + 1}`));
  for (const view of ['liveView', 'scheduleView', 'playersView', 'rankingsView', 'moreView']) {
    await page.locator(`[data-view="${view}"]`).click();
    await expect(page.locator('#stickyLive')).toHaveCount(0);
  }
  expect(bounds.addVisible).toBeTruthy();
  expect(bounds.courtVisible).toBeTruthy();

  const navBeforeScroll = await page.locator('.bottom-nav').evaluate(node => node.getBoundingClientRect().top);
  await page.evaluate(() => window.scrollTo(0, 500));
  const navAfterScroll = await page.locator('.bottom-nav').evaluate(node => node.getBoundingClientRect().top);
  expect(navAfterScroll).toBeLessThanOrEqual(navBeforeScroll + 1);
});

test('Complete game uses a separate score step and blocks a contradictory winner score', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(4));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(3, { timeout: 5000 });

  await page.locator('#completeBtn').click();
  await expect(page.locator('.sheet-title')).toHaveText('Game 1 result');
  await page.locator('[data-winner="0"]').click();
  await expect(page.locator('.sheet-title')).toHaveText('Enter final score');
  await expect(page.locator('.winner-badge')).toHaveText('✓ Winner');
  await expect(page.locator('#matchLogCount')).toHaveText('0');
  await page.locator('#scoreA').fill('5');
  await page.locator('#scoreB').fill('11');
  await page.locator('#scoreConfirm').click();
  await expect(page.locator('#scoreError')).toHaveText('The selected winner cannot have a lower score than the other team.');
  await expect(page.locator('#matchLogCount')).toHaveText('0');

  await page.locator('#scoreBack').click();
  await expect(page.locator('.sheet-title')).toHaveText('Game 1 result');
  await expect(page.locator('[data-winner="0"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-winner="1"]')).toBeVisible();

  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
  await expect(page.locator('#matchLogCount')).toHaveText('1');
  const winnerNames = await page.locator('.match-log-team.match-log-winner .live-player-name').allTextContents();
  expect(winnerNames).toHaveLength(2);
  const winnerText = winnerNames.map(name => name.replace(/\s*⭐+\s*$/, '').trim()).join(' and ');
  await expect(page.locator('.match-log-result')).toContainText(`Winner: ${winnerText}`);
  await expect(page.locator('.match-log-result')).toContainText('11 – 7');
  await expect(page.locator('.match-log-result')).not.toContainText('⭐');
});

test('Win by 2 toggle persists across games and validates deuce scores', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(8));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(12, { timeout: 5000 });

  await page.locator('#completeBtn').click();
  await page.locator('[data-winner="0"]').click();
  await expect(page.locator('#winByTwoToggle')).not.toBeChecked();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('10');
  await page.locator('#scoreConfirm').click();
  await expect(page.locator('#matchLogCount')).toHaveText('1');
  await expect(page.locator('.deuce-badge')).toHaveCount(1);

  await page.locator('#completeBtn').click();
  await page.locator('[data-winner="0"]').click();
  await expect(page.locator('#winByTwoToggle')).not.toBeChecked();
  await page.locator('#winByTwoToggle').check();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('10');
  await page.locator('#scoreConfirm').click();
  await expect(page.locator('#scoreError')).toContainText('At 10-10 or later');
  await page.locator('#scoreA').fill('12');
  await page.locator('#scoreB').fill('10');
  await page.locator('#scoreConfirm').click();
  await expect(page.locator('#matchLogCount')).toHaveText('2');
  await expect(page.locator('.deuce-badge')).toHaveCount(2);

  await page.locator('#completeBtn').click();
  await page.locator('[data-winner="0"]').click();
  await expect(page.locator('#winByTwoToggle')).toBeChecked();
  await page.locator('#winByTwoToggle').uncheck();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
  await expect(page.locator('.deuce-badge')).toHaveCount(2);
});
test('Next game free swap commits the generated game unchanged without validation blocking', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(5));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(5, { timeout: 5000 });

  const before = await page.evaluate(() => {
    const currentTeams = [...document.querySelectorAll('#currentTeams .team')]
      .map(node => node.textContent.trim());
    const nextRow = document.querySelector('#scheduleList .game-row:nth-child(2)');
    const upcomingNames = [...document.querySelectorAll('#upNextList .next-item:first-child .live-player-name')]
      .map(node => node.textContent.replace(/\s*⭐+\s*$/, '').trim());
    return {
      currentTeams,
      currentNames: [...document.querySelectorAll('#currentTeams .live-player-name')].map(node => node.textContent.replace(/\s*⭐+\s*$/, '').trim()),
      upcomingNames,
      progress: document.querySelector('#progressText')?.textContent || '',
      logCount: document.querySelector('#matchLogCount')?.textContent || '',
      nextMatch: nextRow?.querySelector('.game-match')?.textContent.replace(/⭐/g, '').replace(/\s+/g, ' ').trim() || '',
      nextLabels: [...(nextRow?.querySelectorAll('.game-team-label') || [])].map(node => node.textContent || ''),
    };
  });

  await page.locator('#nextBtn').click();

  const after = await page.evaluate(() => ({
    currentNames: [...document.querySelectorAll('#currentTeams .live-player-name')]
      .map(node => node.textContent.replace(/\s*⭐+\s*$/, '').trim()),
    currentTeams: [...document.querySelectorAll('#currentTeams .team')]
      .map(node => node.textContent.trim()),
    firstUpNextNames: [...document.querySelectorAll('#upNextList .next-item:first-child .live-player-name')]
      .map(node => node.textContent.replace(/\s*⭐+\s*$/, '').trim()),
    firstLabel: document.querySelector('#upNextList .next-item:first-child > span:first-child')?.textContent || '',
    progress: document.querySelector('#progressText')?.textContent || '',
    logCount: document.querySelector('#matchLogCount')?.textContent || '',
    firstMatch: document.querySelector('#scheduleList .game-row:nth-child(1) .game-match')?.textContent.replace(/⭐/g, '').replace(/\s+/g, ' ').trim() || '',
    firstLabels: [...document.querySelectorAll('#scheduleList .game-row:nth-child(1) .game-team-label')].map(node => node.textContent || ''),
    status: document.querySelector('#nextGameStatus')?.textContent || '',
  }));

  expect(after.currentNames).toEqual(before.upcomingNames);
  expect(after.firstUpNextNames).toEqual(before.currentNames);
  expect(after.currentTeams.join(' | ')).not.toBe('');
  expect(after.firstLabel).toBe('Game 2');
  expect(after.progress).toBe(before.progress);
  expect(after.logCount).toBe(before.logCount);
  expect(after.firstMatch).toBe(before.nextMatch);
  expect(after.firstLabels).toEqual(before.nextLabels);
  expect(after.status).toBe('');
  await expect(page.locator('#currentNo')).toHaveText('GAME 1');
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
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
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
  const inProgressPanelHeight = await page.locator('#liveView .live-upnext-column > .upnext').evaluate(node => node.getBoundingClientRect().height);

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
  for (let i = 0; i < 11; i++) {
    await page.locator('#completeBtn').click();
    await page.locator('[data-winner="0"]').click();
    await page.locator('#scoreA').fill('11');
    await page.locator('#scoreB').fill('7');
    await page.locator('#scoreConfirm').click();
  }
  await expect(page.locator('#currentNo')).toHaveText('GAME 12');
  await expect(page.locator('#liveView .live-upnext-column')).toBeHidden();
  await expect(page.locator('#liveView .live-grid')).toHaveClass(/no-upcoming/);
  await page.locator('#completeBtn').click();
  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
  await expect(page.locator('.sheet.final-rankings')).toBeVisible();
  await page.locator('#completeCloseBtn').click();
  await expect(page.locator('#liveView .live-upnext-column')).toBeHidden();
  await expect(page.locator('#liveView .live-grid')).toHaveClass(/no-upcoming/);
  const completeBounds = await page.evaluate(() => {
    const main = document.querySelector('#liveView .live-main-column')?.getBoundingClientRect();
    const grid = document.querySelector('#liveView .live-grid')?.getBoundingClientRect();
    return { mainWidth: main?.width || 0, gridWidth: grid?.width || 0 };
  });
  expect(Math.abs(completeBounds.mainWidth - completeBounds.gridWidth)).toBeLessThanOrEqual(1);
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
  await expect(page.locator('.game-match')).toHaveCount(3, { timeout: 5000 });

  await expect(page.locator('#setupNavBtn')).toBeHidden();
  await expect(page.locator('[data-view="liveView"]')).toHaveClass(/active/);
  await expect(page.locator('.bottom-nav .nav-btn:not([hidden])')).toHaveCount(5);
  await expect.poll(() => page.locator('.bottom-nav').evaluate(node => getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).length)).toBe(5);

  await page.locator('[data-view="moreView"]').click();
  await page.locator('#manageSessionBtn').click();
  await expect(page.locator('#setupView')).toHaveClass(/active/);
  await expect(page.locator('#setupView .grid-setup')).toBeVisible();
  await expect(page.locator('#setupSummary')).toHaveCount(0);

  await expect(page.locator('#setupView .grid-setup')).toBeVisible();

  await page.locator('[data-view="playersView"]').click();
  const playerCard = page.locator('.player-card').first();
  await expect(playerCard.locator('.player-name-rating')).toBeVisible();
  await expect(playerCard.locator('.player-skill-stars')).toHaveText(/⭐{1,6}/);
  await expect(playerCard.locator('.stat-chip').first()).toContainText(/\d+ games?/);

  await page.locator('[data-view="liveView"]').click();
  await page.locator('#completeBtn').click();
  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
  for (let i = 0; i < 2; i++) { await page.locator('#completeBtn').click(); await page.locator('[data-winner="0"]').click(); await page.locator('#scoreA').fill('11'); await page.locator('#scoreB').fill('7'); await page.locator('#scoreConfirm').click(); }
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
  expect(modalStyles.gameChip).toBe('3 games');
  expect(modalStyles.display).toBe('flex');
  expect(modalStyles.wrap).toBe('nowrap');

  await page.locator('#completeCloseBtn').click();
  await page.locator('[data-view="rankingsView"]').click();
  const firstRanksRow = page.locator('.rank-row').first();
  await expect(firstRanksRow).toHaveClass(/first-place/);
  await expect(firstRanksRow.locator('.rank-stats .rank-chip').nth(2)).toHaveText('3 games');

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

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.reload();
  console.log('CRG-RELOAD-DIAG', JSON.stringify({
    pageErrors,
    consoleErrors,
    storage: await page.evaluate(() => Object.fromEntries(
      Object.keys(localStorage)
        .filter(key => /^(crg-live-state-v1|crg-supabase-host-key-v1:)/.test(key))
        .map(key => [key, localStorage.getItem(key)])
    )),
    activeView: await page.locator('.view.active').getAttribute('id').catch(() => null),
    sessionCodeText: await page.locator('#sessionCodeText').textContent().catch(() => null),
    setupStatus: await page.locator('#setupStatus').textContent().catch(() => null),
    sheetClass: await page.locator('#sheet').getAttribute('class').catch(() => null)
  }));
  await expect(page.locator('.sheet.final-rankings')).toBeVisible();
  await page.locator('#completeCloseBtn').click();
  await expect(page.locator('#setupNavBtn')).toBeHidden();
  await expect(page.locator('.bottom-nav .nav-btn:not([hidden])')).toHaveCount(5);

  await page.locator('[data-view="moreView"]').click();
  await page.locator('#manageSessionBtn').click();
  await page.locator('#clearAllPlayersBtn').click();
  await expect(page.locator('#setupNavBtn')).toBeVisible();
  await expect(page.locator('.bottom-nav .nav-btn')).toHaveCount(6);
  await expect(page.locator('#setupView')).toHaveClass(/active/);
  await expect(page.locator('#scheduleList .game-row')).toHaveCount(0);
});



test('Feature 25 removes timing inputs and locks Games per player to Auto', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#duration')).toHaveCount(0);
  await expect(page.locator('#sessionLength')).toHaveCount(0);
  const games=page.locator('#games');
  await expect(games).toHaveValue('Auto');
  await expect(games).toHaveAttribute('readonly', '');
  await expect(games).toHaveAttribute('aria-readonly', 'true');
  await expect(games).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#gamesHint')).toHaveText('Games per player are calculated automatically to balance the session.');
  await expect(page.locator('#courts')).toBeEditable();
});

test('Paste names modal uses themed scrollbars without changing the textarea layout', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  const textarea=page.locator('#pastePlayerNames');
  await expect(textarea).toBeVisible();
  const before=await textarea.evaluate(el => ({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,resize:getComputedStyle(el).resize}));
  await textarea.fill(Array.from({length:40},(_,i)=>'Player '+(i+1)).join('\n'));
  const scroll=await textarea.evaluate(el => {
    const track=getComputedStyle(el,'::-webkit-scrollbar');
    const thumb=getComputedStyle(el,'::-webkit-scrollbar-thumb');
    const button=getComputedStyle(el,'::-webkit-scrollbar-button');
    return {overflow:getComputedStyle(el).overflowY,scrollable:el.scrollHeight>el.clientHeight,width:track.width,trackBackground:getComputedStyle(el,'::-webkit-scrollbar-track').backgroundColor,thumbBackground:thumb.backgroundColor,thumbRadius:thumb.borderRadius,buttonDisplay:button.display};
  });
  expect(scroll.scrollable).toBeTruthy();
  expect(scroll.overflow).toBe('auto');
  expect(scroll.width).toBe('8px');
  expect(scroll.trackBackground).toBe('rgb(55, 64, 48)');
  expect(scroll.thumbBackground).toBe('rgb(184, 166, 123)');
  expect(scroll.thumbRadius).toBe('999px');
  expect(scroll.buttonDisplay).toBe('none');
  const after=await textarea.evaluate(el => ({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,resize:getComputedStyle(el).resize}));
  expect(after).toEqual(before);
  const sheet=await page.locator('.sheet-panel').evaluate(el => ({
    overflow:getComputedStyle(el).overflow,
    thumbBackground:getComputedStyle(el,'::-webkit-scrollbar-thumb').backgroundColor,
    trackBackground:getComputedStyle(el,'::-webkit-scrollbar-track').backgroundColor,
    buttonDisplay:getComputedStyle(el,'::-webkit-scrollbar-button').display
  }));
  expect(sheet.overflow).toBe('auto');
  expect(sheet.thumbBackground).toBe('rgb(184, 166, 123)');
  expect(sheet.trackBackground).toBe('rgb(55, 64, 48)');
  expect(sheet.buttonDisplay).toBe('none');
});

test('Feature 24 timer starts, persists across refresh, resets on swap, and records completed duration', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(4));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(3, { timeout: 5000 });
  await expect(page.locator('#currentTimer')).toHaveText('00:00');
  await page.waitForTimeout(2200);
  const running=await page.locator('#currentTimer').textContent();
  expect(running).toMatch(/^00:0[2-9]$/);
  const startedBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem('crg-live-state-v1')).gameStartedAt);
  expect(Number.isFinite(Number(startedBefore))).toBeTruthy();

  await page.reload();
  await expect(page.locator('#currentTimer')).toHaveText(/00:0[2-9]/);
  const restoredStarted=await page.evaluate(()=>JSON.parse(localStorage.getItem('crg-live-state-v1')).gameStartedAt);
  expect(restoredStarted).toBe(startedBefore);

  const beforeSwap=await page.locator('#currentTimer').textContent();
  await page.locator('#nextBtn').click();
  await expect(page.locator('#currentNo')).toHaveText('GAME 1');
  const resetTimer=await page.locator('#currentTimer').textContent();
  expect(resetTimer).toMatch(/^00:0[01]$/);
  expect(beforeSwap).not.toBe('00:00');
  const swapStarted=await page.evaluate(()=>JSON.parse(localStorage.getItem('crg-live-state-v1')).gameStartedAt);
  expect(Number.isFinite(Number(swapStarted))).toBeTruthy();
  expect(Date.now()-Number(swapStarted)).toBeLessThan(1500);

  await page.waitForTimeout(1200);
  await page.locator('#completeBtn').click();
  const paused=await page.locator('#currentTimer').textContent();
  expect(paused).toMatch(/^00:0[1-9]$/);
  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
  await expect(page.locator('#matchLog .match-log-result').first()).toContainText(paused);
  const saved=await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('crg-live-state-v1'));return Number(d.gameDurations['0'])});
  expect(saved).toBeGreaterThanOrEqual(1);
  expect(saved).toBeLessThanOrEqual(5);
});

test('Reset everything sits in its own card below Session summary', async ({ page }) => {
  await page.setViewportSize({ width:1280, height:900 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('[data-view="moreView"]').click();
  const session=page.locator('#moreView .tools-grid > .card').nth(0);
  const summary=page.locator('#moreView .summary-card');
  const reset=page.locator('#moreView .session-reset-card');
  await expect(session).toBeVisible();
  await expect(summary).toBeVisible();
  await expect(reset).toBeVisible();
  await expect(session.locator('#resetBtn')).toHaveCount(0);
  await expect(session.locator('.tool-divider')).toHaveCount(0);
  await expect(reset.locator('#resetBtn')).toBeVisible();
  const rects=await page.evaluate(()=>{const s=document.querySelector('#moreView .summary-card')?.getBoundingClientRect(),r=document.querySelector('#moreView .session-reset-card')?.getBoundingClientRect();return{sTop:s?.top||0,sBottom:s?.bottom||0,sLeft:s?.left||0,rTop:r?.top||0,rLeft:r?.left||0}});
  expect(rects.rTop).toBeGreaterThanOrEqual(rects.sBottom-1);
  expect(Math.abs(rects.rLeft-rects.sLeft)).toBeLessThanOrEqual(1);
});

test('Feature 21 reset action remains safe and fully restores Setup defaults', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(4));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(3, { timeout: 5000 });
  await page.locator('#completeBtn').click();
  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
  for (let i = 0; i < 2; i++) { await page.locator('#completeBtn').click(); await page.locator('[data-winner="0"]').click(); await page.locator('#scoreA').fill('11'); await page.locator('#scoreB').fill('7'); await page.locator('#scoreConfirm').click(); }
  await expect(page.locator('.sheet.final-rankings')).toBeVisible();
  await page.locator('#finalResetBtn').click();
  await expect(page.locator('.sheet:not([hidden]) .sheet-title')).toHaveText('Reset everything?');
  await page.locator('#finalResetCancel').click();
  await expect(page.locator('.sheet.final-rankings')).toBeVisible();
  await expect(page.locator('#matchLogCount')).toHaveText('3');
  await page.locator('#finalResetBtn').click();
  await page.locator('#finalResetConfirm').click();
  await expect(page.locator('#setupView')).toHaveClass(/active/);
  await expect(page.locator('#setupNavBtn')).toBeVisible();
  await expect(page.locator('.bottom-nav .nav-btn')).toHaveCount(6);
  await expect(page.locator('#names')).toHaveValue('');
  await expect(page.locator('#games')).toHaveValue('Auto');
  await expect(page.locator('#courts')).toHaveValue('1');
  await expect(page.locator('#duration')).toHaveCount(0);
  await expect(page.locator('#sessionLength')).toHaveCount(0);
  await expect(page.locator('#matchLogCount')).toHaveText('0');
  await expect(page.locator('#scheduleList .game-row')).toHaveCount(0);
  await expect(page.locator('#rankingsList .rank-row')).toHaveCount(0);
});

test('Header navigation is vertically centered against the full header text block', async ({ page }) => {
  for (const width of [1280, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const metrics=await page.evaluate(()=>{const block=document.querySelector('.topbar > div')?.getBoundingClientRect();const nav=document.querySelector('.topbar .bottom-nav')?.getBoundingClientRect();const style=document.querySelector('.topbar .bottom-nav')?getComputedStyle(document.querySelector('.topbar .bottom-nav')):null;return{blockTop:block?.top||0,blockBottom:block?.bottom||0,navTop:nav?.top||0,navBottom:nav?.bottom||0,alignSelf:style?.alignSelf||''}});
    expect(metrics.alignSelf).toBe('center');
    const blockMid=(metrics.blockTop+metrics.blockBottom)/2;
    const navMid=(metrics.navTop+metrics.navBottom)/2;
    expect(Math.abs(blockMid-navMid)).toBeLessThanOrEqual(1);
  }
});


test('Feature 23 opens QR/copy-link popup and shared link renders read-only rankings', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(4));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(3, { timeout: 5000 });
  await page.locator('#completeBtn').click();
  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
  for (let i = 0; i < 2; i++) { await page.locator('#completeBtn').click(); await page.locator('[data-winner="0"]').click(); await page.locator('#scoreA').fill('11'); await page.locator('#scoreB').fill('7'); await page.locator('#scoreConfirm').click(); }
  await expect(page.locator('.sheet.final-rankings')).toBeVisible();

  const modalRows = await page.locator('.complete-rank-row').evaluateAll(rows => rows.map(row => ({
    place: row.querySelector('.complete-place')?.textContent.trim() || '',
    name: row.querySelector('.complete-name')?.textContent.trim() || '',
    wins: row.querySelector('.complete-wins')?.textContent.trim() || '',
    losses: row.querySelector('.complete-losses')?.textContent.trim() || '',
    games: row.querySelector('.complete-games-played')?.textContent.trim() || '',
    pct: row.querySelector('.complete-win-pct')?.textContent.trim() || '',
  })));

  await page.locator('#finalShareBtn').click();
  await expect(page.locator('.sheet.final-share')).toBeVisible();
  await expect(page.locator('#finalResultsQr svg')).toBeVisible();
  await expect(page.locator('#finalResultsQr svg path')).toHaveAttribute('d', /.+/);
  const link = await page.locator('#finalResultsLink').inputValue();
  expect(link).toMatch(/#results=[A-Za-z0-9_-]+$/);

  await page.evaluate(() => {
    window.__clipboardText = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { window.__clipboardText = text; } },
    });
  });
  await page.locator('#finalResultsCopyBtn').click();
  await expect(page.locator('#finalResultsCopyStatus')).toHaveText('Copied!');
  await expect.poll(() => page.evaluate(() => window.__clipboardText)).toBe(link);

  const shared = await page.context().newPage();
  await shared.goto(link);
  await shared.waitForLoadState('domcontentloaded');
  await expect(shared.locator('.shared-results-page')).toBeVisible();
  const sharedRows = await shared.locator('.shared-results-rankings .complete-rank-row').evaluateAll(rows => rows.map(row => ({
    place: row.querySelector('.complete-place')?.textContent.trim() || '',
    name: row.querySelector('.complete-name')?.textContent.trim() || '',
    wins: row.querySelector('.complete-wins')?.textContent.trim() || '',
    losses: row.querySelector('.complete-losses')?.textContent.trim() || '',
    games: row.querySelector('.complete-games-played')?.textContent.trim() || '',
    pct: row.querySelector('.complete-win-pct')?.textContent.trim() || '',
  })));
  expect(sharedRows).toEqual(modalRows);
  await shared.close();

  await page.locator('#finalResultsCloseBtn').click();
  await expect(page.locator('.sheet.final-rankings')).toBeVisible();
});


test('Feature 22 hides Up Next when there are no upcoming games and restores it when games return', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(8));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(12, { timeout: 5000 });
  await expect(page.locator('#liveView .live-upnext-column')).toBeVisible();

  for (let i = 0; i < 12; i++) {
    await page.locator('#completeBtn').click();
    await page.locator('[data-winner="0"]').click();
    await page.locator('#scoreA').fill('11');
    await page.locator('#scoreB').fill('7');
    await page.locator('#scoreConfirm').click();
  }
  await expect(page.locator('.sheet.final-rankings')).toBeVisible();
  await page.locator('#completeCloseBtn').click();
  await expect(page.locator('#liveView .live-upnext-column')).toBeHidden();
  await expect(page.locator('#liveView .live-grid')).toHaveClass(/no-upcoming/);
  const completeLayout=await page.evaluate(()=>{const grid=document.querySelector('#liveView .live-grid')?.getBoundingClientRect();const main=document.querySelector('#liveView .live-main-column')?.getBoundingClientRect();return{gridWidth:grid?.width||0,mainWidth:main?.width||0}});
  expect(Math.abs(completeLayout.gridWidth-completeLayout.mainWidth)).toBeLessThanOrEqual(1);

  await page.locator('[data-view="moreView"]').click();
  await page.locator('#manageSessionBtn').click();
  await expect(page.locator('#games')).toHaveValue('Auto');
  await page.locator('#generateBtn').click();
  await expect(page.locator('#liveView .live-upnext-column')).toBeVisible();
  await expect(page.locator('#liveView .live-grid')).not.toHaveClass(/no-upcoming/);
});
