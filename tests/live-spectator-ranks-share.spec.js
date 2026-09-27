const { test, expect } = require('@playwright/test');

const roster = count => Array.from({ length: count }, (_, i) => 'Player ' + (i + 1)).join('\n');

async function mockSupabase(context) {
  await context.addInitScript(() => {
    const STORAGE_KEY = '__crg_mock_live_session__';
    const read = () => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
      catch { return null; }
    };
    const mockClient = () => ({
      from() {
        return {
          upsert: async row => {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(row));
            return { data: row, error: null };
          },
          select() {
            return {
              eq(_field, code) {
                return {
                  maybeSingle: async () => {
                    const row = read();
                    return row?.session_code === code
                      ? { data: { payload: row.payload }, error: null }
                      : { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      },
      channel() {
        let listener = null;
        const api = {
          on(_event, _config, callback) {
            listener = callback;
            window.addEventListener('storage', event => {
              if (event.key !== STORAGE_KEY || !event.newValue || !listener) return;
              try {
                const row = JSON.parse(event.newValue);
                if (row?.payload) listener({ new: { payload: row.payload } });
              } catch {}
            });
            return api;
          },
          subscribe() { return api; },
          unsubscribe() { listener = null; },
        };
        return api;
      },
    });

    window.supabase = { createClient: mockClient };
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async value => {
            window.__crgCopiedText = String(value);
          },
        },
      });
    } catch {}
  });
}

async function generateSession(page, playerCount, expectedGames) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(350);
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(playerCount));
  await page.locator('#playerConfirm').click();
  await expect(page.locator('#playerList .player-row')).toHaveCount(playerCount, { timeout: 2500 });
  await page.locator('#generateBtn').click();
  await expect(page.locator('#setupStatus')).toContainText('Rotation ready', { timeout: 5000 });
  await expect(page.locator('.game-match')).toHaveCount(expectedGames, { timeout: 5000 });
}

async function completeCurrentGame(page) {
  await page.locator('#completeBtn').click();
  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
}

async function currentNames(page) {
  return page.locator('#currentTeams .team').evaluateAll(teams =>
    teams.flatMap(team => (team.textContent || '').split(/\s*\+\s*/).map(s => s.trim()).filter(Boolean))
  );
}

test('Up Next uses one consistent 8px gap from header to cards and last card to panel border', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await generateSession(page, 10, 15);

  const measurements = await page.evaluate(() => {
    const panel = document.querySelector('#liveView .live-upnext-column > .upnext');
    const header = panel?.querySelector('.card-head');
    const cards = [...document.querySelectorAll('#upNextList .next-item[data-upcoming-index]')];
    const panelRect = panel?.getBoundingClientRect();
    const headerRect = header?.getBoundingClientRect();
    const cardRects = cards.map(node => node.getBoundingClientRect());
    return {
      topGap: cardRects[0] ? cardRects[0].top - (headerRect?.bottom || 0) : -1,
      gaps: cardRects.slice(1).map((rect, i) => rect.top - cardRects[i].bottom),
      bottomGap: cardRects.at(-1) && panelRect ? panelRect.bottom - cardRects.at(-1).bottom : -1,
      inlineHeight: panel?.style.getPropertyValue('--upnext-panel-height') || '',
      cardCount: cards.length,
    };
  });

  expect(measurements.cardCount).toBe(4);
  expect(Math.abs(measurements.topGap - 8)).toBeLessThanOrEqual(1);
  expect(measurements.gaps.every(gap => Math.abs(gap - 8) <= 1)).toBeTruthy();
  expect(Math.abs(measurements.bottomGap - 8)).toBeLessThanOrEqual(1);
  expect(measurements.inlineHeight).toBe('');

  await page.screenshot({ path: 'test-results/upnext-spacing-4-cards.png', fullPage: true });
});

test('Copy live spectator link shows the current game and updates after a completed game', async ({ page, context }) => {
  await mockSupabase(context);
  await generateSession(page, 4, 3);

  const hostGame = await page.locator('#currentNo').innerText();
  const hostCourt = await page.locator('#currentCourt').innerText();
  const hostTimer = await page.locator('#currentTimer').innerText();
  const hostNames = await currentNames(page);
  expect(hostGame).toBe('GAME 1');
  expect(hostCourt).toMatch(/^COURT \d+$/);
  expect(hostTimer).toMatch(/^\d{2}:\d{2}$/);

  await page.locator('#copyLiveSpectatorBtn').click();
  await expect.poll(() => page.evaluate(() => window.__crgCopiedText || '')).toContain('view=spectator');

  const liveUrl = await page.evaluate(() => window.__crgCopiedText);
  const spectator = await context.newPage();
  await spectator.goto(liveUrl);
  await spectator.waitForLoadState('domcontentloaded');
  await expect(spectator.locator('.spectator-current h2')).toHaveText(hostGame);
  await expect(spectator.locator('.spectator-current .spectator-player-name')).toHaveCount(4);
  expect(await spectator.locator('.spectator-current .spectator-player-name').allTextContents()).toEqual(hostNames);
  await expect(spectator.locator('.spectator-current .eyebrow')).toContainText(hostCourt);
  await expect(spectator.locator('.spectator-live-meta strong')).toHaveText(hostTimer);
  await expect(spectator.locator('.spectator-progress')).toContainText('0 / 3 games');

  await completeCurrentGame(page);

  await expect(spectator.locator('.spectator-current h2')).toHaveText('GAME 2', { timeout: 6000 });
  await expect(spectator.locator('.spectator-progress')).toContainText('1 / 3 games', { timeout: 6000 });
  const nextHostNames = await currentNames(page);
  expect(await spectator.locator('.spectator-current .spectator-player-name').allTextContents()).toEqual(nextHostNames);
  await expect(spectator.locator('.spectator-live-meta strong')).toHaveText(/^\d{2}:\d{2}$/);
  await spectator.close();
});

test('Ranks Share Results works before and after results and updates the shared leaderboard live', async ({ page, context }) => {
  await mockSupabase(context);
  await generateSession(page, 4, 3);
  await page.locator('[data-view="rankingsView"]').click();
  await expect(page.locator('#shareLeaderboardBtn')).toBeVisible();

  await page.locator('#shareLeaderboardBtn').click();
  await expect(page.locator('.sheet.final-share')).toBeVisible();
  await expect(page.locator('#finalResultsQr svg')).toBeVisible();
  const noResultUrl = await page.locator('#finalResultsLink').inputValue();
  expect(noResultUrl).toContain('view=leaderboard');
  await page.locator('#finalResultsCopyBtn').click();
  await expect(page.locator('#finalResultsCopyStatus')).toHaveText('Copied!');
  await page.locator('#finalResultsCloseBtn').click();

  const shared = await context.newPage();
  await shared.goto(noResultUrl);
  await shared.waitForLoadState('domcontentloaded');
  await expect(shared.locator('.shared-live-leaderboard-page')).toBeVisible();
  await expect(shared.locator('.spectator-leaderboard')).toContainText('No results yet');

  await completeCurrentGame(page);

  await expect(shared.locator('.spectator-leaderboard .rank-row').first()).toBeVisible({ timeout: 6000 });
  await expect(shared.locator('.spectator-leaderboard')).not.toContainText('No results yet');
  await expect(shared.locator('.spectator-leaderboard .rank-chip').first()).toContainText('1W');

  await page.locator('[data-view="rankingsView"]').click();
  await page.locator('#shareLeaderboardBtn').click();
  await expect(page.locator('.sheet.final-share')).toBeVisible();
  await expect(page.locator('#finalResultsQr svg')).toBeVisible();
  const resultUrl = await page.locator('#finalResultsLink').inputValue();
  expect(resultUrl).toBe(noResultUrl);
  await page.locator('#finalResultsCloseBtn').click();

  await shared.screenshot({ path: 'test-results/shared-live-leaderboard.png', fullPage: true });
  await shared.close();
});
