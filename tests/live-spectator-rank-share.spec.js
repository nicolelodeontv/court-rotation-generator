const { test, expect } = require('@playwright/test');

const roster = count => Array.from({ length: count }, (_, i) => 'Player ' + (i + 1)).join('\n');

async function installFakeSupabase(page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (String(url).includes('/api/live-config')) {
        return Promise.resolve(new Response(JSON.stringify({
          configured: true,
          url: 'https://fake.supabase.test',
          publishableKey: 'fake-key',
          source: 'test-fixture',
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return originalFetch(input, init);
    };
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      value: {
        createClient: () => {
          const storageKey = 'crg-fake-live-sessions-v1';
          const readSessions = () => {
            try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
          };
          const writeSession = (code, payload) => {
            const sessions = readSessions();
            sessions[String(code)] = { payload, updatedAt: new Date().toISOString() };
            localStorage.setItem(storageKey, JSON.stringify(sessions));
          };
          window.__crgSeedLivePayload = (code, payload) => writeSession(code, payload);
          return {
            from: () => {
              const chain = {
                _code: '',
                select() { return chain; },
                eq(_field, code) { chain._code = String(code); return chain; },
                async maybeSingle() {
                  const row = readSessions()[chain._code];
                  return row
                    ? { data: { payload: row.payload, updated_at: row.updatedAt }, error: null }
                    : { data: null, error: null };
                },
                async upsert(row) {
                  writeSession(row.session_code, row.payload);
                  return { data: null, error: null };
                },
              };
              return chain;
            },
            async rpc(name, args) {
              if (name !== 'publish_session') return { data: null, error: { message: 'Unsupported RPC' } };
              writeSession(args?.p_code, args?.p_payload);
              return { data: true, error: null };
            },
            channel: topic => {
              const bc = new BroadcastChannel(topic);
              const api = {
                on(_type, config, handler) {
                  bc.addEventListener('message', event => {
                    const data = event.data;
                    if (data?.event === config?.event) handler({ payload: data.payload });
                  });
                  return api;
                },
                subscribe(callback) {
                  setTimeout(() => callback?.('SUBSCRIBED'), 0);
                  return api;
                },
                send(message) {
                  bc.postMessage(message);
                  return Promise.resolve('ok');
                },
                unsubscribe() {
                  try { bc.close(); } catch {}
                  return Promise.resolve();
                },
              };
              return api;
            },
          };
        },
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
  page.on('pageerror', error => console.log('[LIVE-REGRESSION][PAGEERROR] ' + error.message));
  page.on('console', message => {
    const value = message.text();
    if (value.includes('CRG') || value.includes('error') || value.includes('Error')) console.log('[LIVE-REGRESSION][CONSOLE] ' + value);
  });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(playerCount));
  await page.locator('#playerConfirm').click();
  await expect(page.locator('#playerList .player-row')).toHaveCount(playerCount, { timeout: 2000 });
  await page.locator('#generateBtn').click();
  try {
    await expect(page.locator('#setupStatus')).toContainText('Rotation ready', { timeout: 8000 });
  } catch (error) {
    console.log('[LIVE-REGRESSION][GENERATE-DIAGNOSTIC] status=' + JSON.stringify(await page.locator('#setupStatus').textContent()) + ' games=' + await page.locator('.game-match').count() + ' scheduler=' + await page.evaluate(() => String(typeof window.RotationScheduler?.generate)));
    throw error;
  }
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

test('Up Next outer and inter-card spacing match the two-column layout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await generateSession(page, 8, 12);

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
      labels: cards.map(card => card.querySelector('.upnext-game-no')?.textContent || ''),
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
  expect(Math.abs(metrics.firstGap - 8)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.interGap - 10)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.bottomGap - 8)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.panelHeight - metrics.panelScrollHeight)).toBeLessThanOrEqual(2);
});

test('Live spectator link shows canonical current game, timer, stars, and updates after a completed game', async ({ page, context }) => {
  await installFakeSupabase(page);
  await generateSession(page, 8, 12);

  const hostCurrent = await page.evaluate(() => ({
    game: document.querySelector('#currentNo')?.textContent.trim(),
    court: document.querySelector('#currentCourt')?.textContent.trim(),
    teams: [...document.querySelectorAll('#currentTeams .live-player-name')].map(n => n.textContent.replace(/\s*⭐+\s*$/, '').trim()),
  }));

  await expect(page.locator('#copyLiveSpectatorBtn')).toBeVisible();
  await page.locator('#copyLiveSpectatorBtn').click();
  const copied = await page.evaluate(() => window.__crgCopiedText);
  expect(copied).toMatch(/[?&]live=CRG-[A-Z0-9]+/);

  const spectator = await context.newPage();
  await installFakeSupabase(spectator);
  await spectator.goto(copied);
  await spectator.waitForLoadState('domcontentloaded');
  await expect(spectator.locator('.spectator-current')).toBeVisible();

  expect(await spectator.locator('.spectator-current h2').textContent()).toBe(hostCurrent.game);
  expect(await spectator.locator('.spectator-current .eyebrow').first().textContent()).toContain(hostCurrent.court);
  const sharedNames = (await spectator.locator('.spectator-current .spectator-player-name').allTextContents()).map(v => v.replace(/\s+⭐+.*$/, '').trim());
  expect(sharedNames).toEqual(hostCurrent.teams);
  expect(await spectator.locator('.spectator-current .crg-team-player small').count()).toBe(4);
  expect((await spectator.locator('.spectator-current .crg-team-player small').allTextContents()).every(v => /⭐/.test(v))).toBeTruthy();
  await expect(spectator.locator('#spectatorLiveTimer')).toBeVisible();
  await expect(spectator.locator('.spectator-progress-label')).toContainText('0 / 12 games');
  await expect(spectator.locator('.live-pill').first()).toContainText('LIVE');

  await completeCurrentGame(page);
  await expect(page.locator('#currentNo')).toHaveText('GAME 2');
  await expect.poll(() => spectator.locator('.spectator-current h2').textContent(), { timeout: 7000 }).toBe('GAME 2');
  await expect.poll(() => spectator.locator('.spectator-progress-label').textContent(), { timeout: 7000 }).toContain('1 / 12 games');
  await expect(spectator.locator('.spectator-current')).toContainText('Player');

  await spectator.close();
});

test('Ranks Share results works before results and remains live after standings change', async ({ page, context }) => {
  await installFakeSupabase(page);
  await generateSession(page, 8, 12);
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
  await expect(shared.locator('.rankings-list .rank-row')).toHaveCount(8);

  await page.locator('#liveLeaderboardShareCloseBtn').click();
  await page.locator('[data-view="liveView"]').click();
  await completeCurrentGame(page);
  await expect(page.locator('#currentNo')).toHaveText('GAME 2');
  await expect.poll(() => shared.locator('.live-leaderboard-empty').count(), { timeout: 7000 }).toBe(0);
  await expect.poll(() => shared.locator('.rankings-list .rank-row').first().innerText(), { timeout: 7000 }).toMatch(/1W/);

  await page.locator('[data-view="rankingsView"]').click();
  await expect(page.locator('#rankingsView')).toHaveClass(/active/);
  await page.locator('#shareRankingsBtn').click();
  await expect(page.locator('.sheet.final-share')).toBeVisible();
  await expect(page.locator('#liveLeaderboardShareQr svg')).toBeVisible();
  const linkAfter = await page.locator('#liveLeaderboardShareLink').inputValue();
  expect(linkAfter).toMatch(/[?&]live-leaderboard=CRG-[A-Z0-9]+/);

  await shared.close();
});
