const { test, expect } = require('@playwright/test');

const roster = count => Array.from({ length: count }, (_, i) => 'Player ' + (i + 1)).join('\n');

async function installFakeSupabase(page) {
  await page.addInitScript(() => {
    const originalSet = window.localStorage.setItem.bind(window.localStorage);
    const keyFor = code => '__fake_crg_live__' + code;
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      value: {
        createClient: () => ({
          from: () => ({
            upsert: async row => {
              originalSet(keyFor(row.session_code), JSON.stringify(row.payload));
              return { error: null };
            },
            select: function () { this._select = true; return this; },
            eq: function (_column, value) { this._code = value; return this; },
            maybeSingle: async function () {
              const raw = window.localStorage.getItem(keyFor(this._code));
              return { data: raw ? { payload: JSON.parse(raw) } : null, error: null };
            },
          }),
          channel: () => ({
            on() { return this; },
            subscribe() { return this; },
            unsubscribe() { return Promise.resolve(); },
          }),
        }),
      },
    });
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async value => { window.__crgCopiedText = String(value); } },
      });
    } catch {}
  });
}

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

async function completeCurrentGame(page) {
  await page.locator('#completeBtn').click();
  await expect(page.locator('[data-winner="0"]')).toBeVisible();
  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
}

test('Up Next outer spacing is uniform and the panel hugs four cards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await generateSession(page, 10, 15);

  const metrics = await page.evaluate(() => {
    const panel = document.querySelector('#liveView .live-upnext-column > .upnext');
    const head = document.querySelector('#liveView .live-upnext-column .card-head');
    const cards = [...document.querySelectorAll('#upNextList .next-item')];
    const rect = node => node?.getBoundingClientRect();
    const panelRect = rect(panel);
    const headRect = rect(head);
    const cardRects = cards.map(rect);
    return {
      count: cards.length,
      labels: cards.map(card => card.querySelector('span:first-child')?.textContent || ''),
      firstGap: cardRects[0] && headRect ? cardRects[0].top - headRect.bottom : -1,
      interGap: cardRects[2] && cardRects[1] ? cardRects[2].top - cardRects[1].bottom : -1,
      bottomGap: panelRect && cardRects.at(-1) ? panelRect.bottom - cardRects.at(-1).bottom : -1,
      customHeight: panel?.style.getPropertyValue('--upnext-panel-height') || '',
      panelHeight: panelRect?.height || 0,
      panelScrollHeight: panel?.scrollHeight || 0,
    };
  });

  expect(metrics.count).toBe(4);
  expect(metrics.labels).toEqual(['Game 2', 'Game 3', 'Game 4', 'Game 5']);
  expect(metrics.customHeight).toBe('');
  expect(metrics.firstGap).toBeGreaterThanOrEqual(7);
  expect(metrics.firstGap).toBeLessThanOrEqual(9);
  expect(metrics.interGap).toBeGreaterThanOrEqual(7);
  expect(metrics.interGap).toBeLessThanOrEqual(9);
  expect(metrics.bottomGap).toBeGreaterThanOrEqual(8);
  expect(metrics.bottomGap).toBeLessThanOrEqual(10);
  expect(Math.abs(metrics.firstGap - metrics.interGap)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.bottomGap - metrics.interGap)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.panelHeight - metrics.panelScrollHeight)).toBeLessThanOrEqual(2);
});

test('Live spectator link shows canonical current game, timer, stars, and updates after a completed game', async ({ page, context }) => {
  await installFakeSupabase(page);
  await generateSession(page, 4, 3);

  const hostCurrent = await page.evaluate(() => ({
    game: document.querySelector('#currentNo')?.textContent.trim(),
    court: document.querySelector('#currentCourt')?.textContent.trim(),
    teams: [...document.querySelectorAll('#currentTeams .live-player-name')].map(n => n.textContent.replace(/\s*⭐+\s*$/, '').trim()),
  }));

  await page.locator('[data-view="moreView"]').click();
  await expect(page.locator('#liveSyncBtn')).toBeVisible();
  await page.locator('#liveSyncBtn').click();
  const liveLink = await expect.poll(() => page.evaluate(() => window.__crgCopiedText || '')).toMatch(/view=spectator&?[^]*live=|[?&]live=CRG-/).catch(()=>{});
  const copied = await page.evaluate(() => window.__crgCopiedText);
  expect(copied).toMatch(/[?&]live=CRG-[A-Z0-9]+/);

  const spectator = await context.newPage();
  await installFakeSupabase(spectator);
  await spectator.goto(copied);
  await spectator.waitForLoadState('domcontentloaded');
  await expect(spectator.locator('.spectator-current')).toBeVisible();

  expect(await spectator.locator('.spectator-current h2').textContent()).toBe(hostCurrent.game);
  expect(await spectator.locator('.spectator-current .eyebrow').first().textContent()).toContain(hostCurrent.court);
  const sharedNames = (await spectator.locator('.spectator-current .spectator-player-name').allTextContents()).map(v => v.replace(/\s*⭐+\s*$/, '').trim());
  expect(sharedNames).toEqual(hostCurrent.teams);
  expect(await spectator.locator('.spectator-current .spectator-player small').count()).toBe(4);
  expect((await spectator.locator('.spectator-current .spectator-player small').allTextContents()).every(v => /⭐/.test(v))).toBeTruthy();
  await expect(spectator.locator('#spectatorLiveTimer')).toBeVisible();
  await expect(spectator.locator('.spectator-progress-label')).toContainText('0 / 3 games');
  await expect(spectator.locator('.live-pill').first()).toContainText('LIVE');

  await completeCurrentGame(page);
  await expect(page.locator('#currentNo')).toHaveText('GAME 2');
  await expect.poll(() => spectator.locator('.spectator-current h2').textContent(), { timeout: 7000 }).toBe('GAME 2');
  await expect.poll(() => spectator.locator('.spectator-progress-label').textContent(), { timeout: 7000 }).toContain('1 / 3 games');
  await expect(spectator.locator('.spectator-current')).toContainText('Player');

  await spectator.close();
});

test('Ranks Share results works before results and remains live after standings change', async ({ page, context }) => {
  await installFakeSupabase(page);
  await generateSession(page, 4, 3);
  await page.locator('[data-view="rankingsView"]').click();

  await expect(page.locator('#rankTopTitle')).toHaveText('No results yet');
  await expect(page.locator('#shareRankingsBtn')).toBeVisible();
  await page.locator('#shareRankingsBtn').click();
  await expect(page.locator('.sheet.final-share')).toBeVisible();
  await expect(page.locator('#liveLeaderboardShareQr svg')).toBeVisible();
  const linkBefore = await page.locator('#liveLeaderboardShareLink').inputValue();
  expect(linkBefore).toMatch(/[?&]live-leaderboard=CRG-[A-Z0-9]+/);

  const shared = await context.newPage();
  await installFakeSupabase(shared);
  await shared.goto(linkBefore);
  await shared.waitForLoadState('domcontentloaded');
  await expect(shared.locator('.live-leaderboard-page')).toBeVisible();
  await expect(shared.locator('.live-pill').first()).toContainText('LIVE');
  await expect(shared.locator('.live-leaderboard-empty')).toContainText('No results yet');
  await expect(shared.locator('.rankings-list .rank-row')).toHaveCount(4);

  await page.locator('#liveLeaderboardShareCloseBtn').click();
  await completeCurrentGame(page);
  await expect(page.locator('#currentNo')).toHaveText('GAME 2');
  await expect.poll(() => shared.locator('.live-leaderboard-empty').count(), { timeout: 7000 }).toBe(0);
  await expect.poll(() => shared.locator('.rankings-list .rank-row').first().innerText(), { timeout: 7000 }).toMatch(/1W/);

  await page.locator('#shareRankingsBtn').click();
  await expect(page.locator('.sheet.final-share')).toBeVisible();
  await expect(page.locator('#liveLeaderboardShareQr svg')).toBeVisible();
  const linkAfter = await page.locator('#liveLeaderboardShareLink').inputValue();
  expect(linkAfter).toMatch(/[?&]live-leaderboard=CRG-[A-Z0-9]+/);

  await shared.close();
});
