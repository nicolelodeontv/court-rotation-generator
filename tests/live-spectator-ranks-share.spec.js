const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, expect } = require('@playwright/test');

const roster = count => Array.from({ length: count }, (_, i) => 'Player ' + (i + 1)).join('\n');

test('live-sync script parses as valid browser JavaScript', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'live-sync.js'), 'utf8');
  expect(() => new vm.Script(source, { filename: 'live-sync.js' })).not.toThrow();
});

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
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(350);
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(playerCount));
  await page.locator('#playerConfirm').click();
  await expect(page.locator('#playerList .player-row')).toHaveCount(playerCount, { timeout: 2500 });
  await page.locator('#generateBtn').click();
  await expect(page.locator('#setupStatus')).toContainText('Rotation ready', { timeout: 8000 });
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

async function currentNames(page) {
  return page.locator('#currentTeams .live-player-name').evaluateAll(nodes =>
    nodes.map(node => (node.childNodes[0]?.textContent || node.textContent || '').replace(/\s+$/, '').trim())
  );
}

test('Up Next keeps four visible cards on a uniform 8px outer/inter-card rhythm', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await generateSession(page, 8, 12);

  const metrics = await page.evaluate(() => {
    const panel = document.querySelector('#liveView .live-upnext-column > .upnext');
    const header = panel?.querySelector('.card-head');
    const cards = [...document.querySelectorAll('#upNextList .next-item[data-upcoming-index]')];
    const panelRect = panel?.getBoundingClientRect();
    const headerRect = header?.getBoundingClientRect();
    const rects = cards.map(node => node.getBoundingClientRect());
    return {
      count: cards.length,
      labels: cards.map(card => card.querySelector('.upnext-game-no')?.textContent || ''),
      topGap: rects[0] && headerRect ? rects[0].top - headerRect.bottom : -1,
      interGaps: rects.slice(1).map((rect, i) => rect.top - rects[i].bottom),
      bottomGap: rects.at(-1) && panelRect ? panelRect.bottom - rects.at(-1).bottom : -1,
      inlineHeight: panel?.style.getPropertyValue('--upnext-panel-height') || '',
      panelHeight: panelRect?.height || 0,
      scrollHeight: panel?.scrollHeight || 0,
    };
  });

  expect(metrics.count).toBe(4);
  expect(metrics.labels).toEqual(['Game 2', 'Game 3', 'Game 4', 'Game 5']);
  expect(metrics.inlineHeight).toBe('');
  expect(Math.abs(metrics.topGap - 8)).toBeLessThanOrEqual(1);
  expect(metrics.interGaps.every(gap => Math.abs(gap - 8) <= 1)).toBeTruthy();
  expect(Math.abs(metrics.bottomGap - 8)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.panelHeight - metrics.scrollHeight)).toBeLessThanOrEqual(2);
});

test('Live spectator link shows current game details and updates after a completed game', async ({ page, context }) => {
  await installFakeSupabase(page);
  await generateSession(page, 8, 12);

  const hostGame = await page.locator('#currentNo').innerText();
  const hostCourt = await page.locator('#currentCourt').innerText();
  const hostNames = await currentNames(page);

  await page.locator('#copyLiveSpectatorBtn').click();
  await expect.poll(() => page.evaluate(() => window.__crgCopiedText || '')).toMatch(/(?:\\?|&)live=CRG-[A-Z0-9]+/);
  const liveUrl = await page.evaluate(() => window.__crgCopiedText);

  const spectator = await context.newPage();
  await installFakeSupabase(spectator);
  await spectator.goto(liveUrl);
  await spectator.waitForLoadState('domcontentloaded');

  await expect(spectator.locator('.spectator-current')).toBeVisible();
  await expect(spectator.locator('.spectator-current h2')).toHaveText(hostGame);
  await expect(spectator.locator('.spectator-current .eyebrow')).toContainText(hostCourt);
  await expect(spectator.locator('.spectator-current .spectator-player-name')).toHaveCount(4);
  const sharedNames=await spectator.locator('.spectator-current .spectator-player-name').evaluateAll(nodes=>nodes.map(node=>(node.childNodes[0]?.textContent||node.textContent||'').replace(/\s+$/,'').trim()));
  expect(sharedNames).toEqual(hostNames);

  const stars = await spectator.locator('.spectator-current .spectator-player small').allTextContents();
  expect(stars).toHaveLength(4);
  expect(stars.every(value => /^⭐{1,6}$/.test(value))).toBeTruthy();
  await expect(spectator.locator('#spectatorLiveTimer')).toBeVisible();
  await expect(spectator.locator('.spectator-progress-label')).toContainText('0 / 12 games');
  await expect(spectator.locator('.live-pill').first()).toContainText('LIVE');

  await completeCurrentGame(page);
  await expect(page.locator('#currentNo')).toHaveText('GAME 2');
  await expect.poll(() => spectator.locator('.spectator-current h2').textContent(), { timeout: 7000 }).toBe('GAME 2');
  await expect.poll(() => spectator.locator('.spectator-progress-label').textContent(), { timeout: 7000 }).toContain('1 / 12 games');
  await expect.poll(async () => spectator.locator('.spectator-current .spectator-player-name').evaluateAll(nodes=>nodes.map(node=>(node.childNodes[0]?.textContent||node.textContent||'').replace(/\s+$/,'').trim())), { timeout: 7000 }).toEqual(await currentNames(page));

  await spectator.close();
});

test('Ranks Share Results works before results and stays live after standings change', async ({ page, context }) => {
  await installFakeSupabase(page);
  await generateSession(page, 8, 12);
  await page.locator('[data-view="rankingsView"]').click();

  await expect(page.locator('#rankTopTitle')).toHaveText('No results yet');
  await expect(page.locator('#shareRankingsBtn')).toBeVisible();
  await page.locator('#shareRankingsBtn').click();
  await expect(page.locator('.sheet.final-share')).toBeVisible();
  await expect(page.locator('#liveLeaderboardShareQr svg')).toBeVisible();

  const noResultsUrl = await page.locator('#liveLeaderboardShareLink').inputValue();
  expect(noResultsUrl).toMatch(/(?:\\?|&)live-leaderboard=CRG-[A-Z0-9]+/);
  expect(noResultsUrl).toContain('view=live-leaderboard');

  const shared = await context.newPage();
  await installFakeSupabase(shared);
  await shared.goto(noResultsUrl);
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
  await page.locator('#shareRankingsBtn').click();
  await expect(page.locator('.sheet.final-share')).toBeVisible();
  await expect(page.locator('#liveLeaderboardShareQr svg')).toBeVisible();
  expect(await page.locator('#liveLeaderboardShareLink').inputValue()).toBe(noResultsUrl);

  await page.locator('#liveLeaderboardShareCloseBtn').click();
  await shared.close();
});
