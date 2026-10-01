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
          const writeSession = (code, payload, hostKey = '') => {
            const sessions = readSessions();
            sessions[String(code)] = { payload, hostKey: String(hostKey || ''), updatedAt: new Date().toISOString() };
            localStorage.setItem(storageKey, JSON.stringify(sessions));
          };
          window.__crgSeedLivePayload = (code, payload, hostKey = '') => writeSession(code, payload, hostKey);
          window.__crgRpcCalls = window.__crgRpcCalls || [];
          window.__crgDirectWrites = Number(window.__crgDirectWrites || 0);
          window.__crgRpcErrors = window.__crgRpcErrors || [];
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
                  window.__crgDirectWrites = Number(window.__crgDirectWrites || 0) + 1;
                  writeSession(row.session_code, row.payload, row.host_key);
                  return { data: null, error: null };
                },
              };
              return chain;
            },
            async rpc(name, args) {
              window.__crgRpcCalls.push({ name, args });
              if (name !== 'publish_session') return { data: null, error: { message: 'Unsupported RPC' } };
              if (window.__crgFailPublishRpc) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.publish_session' } };
              if (window.__crgForceRpcValidation) return { data: null, error: { code: 'P0001', message: 'Invalid host key.' } };
              const existing = readSessions()[String(args?.p_code)];
              if (existing?.hostKey && existing.hostKey !== String(args?.p_host_key || '')) {
                const error = { code: 'CRG01', message: 'Session code is already owned by another host.' };
                window.__crgRpcErrors.push(error);
                return { data: null, error };
              }
              writeSession(args?.p_code, args?.p_payload, args?.p_host_key);
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

  const stars = await spectator.locator('.spectator-current .crg-team-player small').allTextContents();
  expect(stars).toHaveLength(4);
  expect(stars.every(value => /^⭐{1,6}$/.test(value))).toBeTruthy();
  await expect(spectator.locator('#spectatorLiveTimer')).toBeVisible();
  await expect(spectator.locator('.spectator-progress-label')).toContainText('0 / 12 games');
  await expect(spectator.locator('.live-pill').first()).toContainText('LIVE');
  await expect.poll(() => page.evaluate(() => window.__crgRpcCalls?.some(call => call.name === 'publish_session') || false), { timeout: 3000 }).toBeTruthy();

  await completeCurrentGame(page);
  await expect(page.locator('#currentNo')).toHaveText('GAME 2');
  await expect.poll(() => spectator.locator('.spectator-current h2').textContent(), { timeout: 7000 }).toBe('GAME 2');
  await expect.poll(() => spectator.locator('.spectator-progress-label').textContent(), { timeout: 7000 }).toContain('1 / 12 games');
  await expect.poll(async () => spectator.locator('.spectator-current .spectator-player-name').evaluateAll(nodes=>nodes.map(node=>(node.childNodes[0]?.textContent||node.textContent||'').replace(/\s+$/,'').trim())), { timeout: 7000 }).toEqual(await currentNames(page));

  await spectator.close();
});

test('Restored legacy session code and host key are preserved for RPC publish', async ({ page }) => {
  await installFakeSupabase(page);
  const legacyCode = 'CRG-ABC1234';
  const legacyHostKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  await page.addInitScript(({ legacyCode, legacyHostKey }) => {
    const state = {
      v: 2,
      savedAt: Date.now(),
      names: ['Alice', 'Bob', 'Carol', 'Dave'],
      active: [1, 2, 3, 4],
      games: [{ court: 1, teams: [[1, 2], [3, 4]], sitting: [] }],
      done: [],
      results: {},
      scores: {},
      winByTwo: false,
      scoreWinByTwo: {},
      locked: [],
      score: 100,
      config: { courts: 1, effectiveCourts: 1 },
      sessionCode: legacyCode,
      playerTargets: {},
      playerMeta: {},
      gameDurations: {},
      gameStartedAtByIndex: { 0: Date.now() },
      gameTimerPaused: false,
      timerPausedIndex: null,
      waitingCourts: {},
    };
    localStorage.setItem('crg-live-state-v1', JSON.stringify(state));
    localStorage.setItem('crg-supabase-host-key-v1:' + legacyCode, legacyHostKey);
  }, { legacyCode, legacyHostKey });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });
  await expect(page.locator('#sessionCodeText')).toContainText(legacyCode);
  expect(await page.evaluate(code => localStorage.getItem('crg-supabase-host-key-v1:' + code), legacyCode)).toBe(legacyHostKey);
  expect(legacyHostKey).toMatch(/^[0-9a-f]{64}$/);
  const result = await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
  expect(result?.storageReady).toBeTruthy();
  const call = await page.evaluate(() => window.__crgRpcCalls?.find(x => x.name === 'publish_session'));
  expect(call?.args?.p_code).toBe(legacyCode);
  expect(call?.args?.p_host_key).toBe(legacyHostKey);
});

test('Legacy session-code collision is visible and renews to a new-format code', async ({ page, context }) => {
  await installFakeSupabase(page);
  const legacyCode = 'CRG-ABC1234';
  const hostKeyA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const hostKeyB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  await page.addInitScript(({ legacyCode, hostKeyA }) => {
    const state = {
      v: 2,
      savedAt: Date.now(),
      names: ['Alice', 'Bob', 'Carol', 'Dave'],
      active: [1, 2, 3, 4],
      games: [{ court: 1, teams: [[1, 2], [3, 4]], sitting: [] }],
      done: [],
      results: {},
      scores: {},
      winByTwo: false,
      scoreWinByTwo: {},
      locked: [],
      score: 100,
      config: { courts: 1, effectiveCourts: 1 },
      sessionCode: legacyCode,
      playerTargets: {},
      playerMeta: {},
      gameDurations: {},
      gameStartedAtByIndex: { 0: Date.now() },
      gameTimerPaused: false,
      timerPausedIndex: null,
      waitingCourts: {},
    };
    localStorage.setItem('crg-live-state-v1', JSON.stringify(state));
    localStorage.setItem('crg-supabase-host-key-v1:' + legacyCode, hostKeyA);
  }, { legacyCode, hostKeyA });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sessionCodeText')).toContainText(legacyCode);
  const first = await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
  expect(first?.storageReady).toBeTruthy();

  const hostB = await context.newPage();
  await installFakeSupabase(hostB);
  await hostB.addInitScript(({ legacyCode, hostKeyB }) => {
    localStorage.setItem('crg-supabase-host-key-v1:' + legacyCode, hostKeyB);
  }, { legacyCode, hostKeyB });
  await hostB.goto('/');
  await hostB.waitForLoadState('domcontentloaded');

  const result = await hostB.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
  expect(result?.storageReady).toBeTruthy();
  expect(result?.collisionRecovered).toBeTruthy();
  await expect(hostB.locator('#crgToast')).toContainText('Session code was already in use', { timeout: 2000 });

  const errors = await hostB.evaluate(() => window.__crgRpcErrors || []);
  expect(errors.some(e => e.code === 'CRG01' && /already owned/i.test(e.message))).toBeTruthy();

  const calls = await hostB.evaluate(() => window.__crgRpcCalls || []);
  expect(calls.some(x => x.args?.p_code === legacyCode && x.args?.p_host_key === hostKeyB)).toBeTruthy();
  const renewed = await hostB.evaluate(() => window.__crgRpcCalls?.find(x => x.args?.p_code !== 'CRG-ABC1234')?.args?.p_code || '');
  expect(renewed).toMatch(/^CRG-[A-HJ-NP-Z2-9]{10}$/);
  expect(renewed).not.toBe(legacyCode);

  await hostB.close();
});

test('RPC validation errors are not treated as legacy-code collisions', async ({ page }) => {
  await installFakeSupabase(page);
  await generateSession(page, 8, 12);
  const originalCode = await page.locator('#sessionCodeText').innerText();
  await page.evaluate(() => { window.__crgForceRpcValidation = true; });
  const result = await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
  expect(result?.storageReady).toBeFalsy();
  expect(result?.collision).not.toBeTruthy();
  expect(await page.locator('#sessionCodeText').innerText()).toBe(originalCode);
  expect(await page.evaluate(() => window.__crgRpcCalls?.slice(-1)?.[0]?.args?.p_code)).toMatch(/^CRG-[A-Z0-9]+$/);
});

test('Live publish falls back to direct write only when publish_session is missing', async ({ page }) => {
  await installFakeSupabase(page);
  await generateSession(page, 8, 12);
  await page.evaluate(() => { window.__crgFailPublishRpc = true; });
  const result = await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
  expect(result?.storageReady).toBeTruthy();
  expect(await page.evaluate(() => window.__crgDirectWrites || 0)).toBeGreaterThan(0);
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
