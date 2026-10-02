const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, expect } = require('@playwright/test');

const roster = count => Array.from({ length: count }, (_, i) => 'Player ' + (i + 1)).join('\n');

test('live-sync script parses as valid browser JavaScript', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'live-sync.js'), 'utf8');
  expect(() => new vm.Script(source, { filename: 'live-sync.js' })).not.toThrow();
});

async function installFakeSupabase(page, options = {}) {
  const {
    delay = 0,
    config = { configured: true, url: 'https://fake.supabase.test', publishableKey: 'fake-key', source: 'test-fixture' },
    configError = false,
  } = options;

  await page.route('**/api/live-config', async route => {
    if (configError) {
      await route.abort('failed');
      return;
    }
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(config),
    });
  });

  await page.addInitScript(() => {
    const storageKey = 'crg-fake-live-sessions-v2';
    const readSessions = () => {
      try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
    };
    const hashHostKey = async hostKey => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(hostKey || '')));
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    };
    const writeSession = async (code, payload, hostKey = '', expiresAt = '') => {
      const sessions = readSessions();
      sessions[String(code)] = {
        session_code: String(code),
        payload,
        hostKeyHash: await hashHostKey(hostKey),
        updatedAt: new Date().toISOString(),
        expiresAt: expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      localStorage.setItem(storageKey, JSON.stringify(sessions));
    };

    window.__crgSeedLivePayload = (code, payload, hostKey = '', expiresAt = '') =>
      writeSession(code, payload, hostKey, expiresAt);
    window.__crgRpcCalls = [];
    window.__crgRpcErrors = [];
    window.__crgDirectWrites = 0;
    window.__crgSelectCalls = [];
    window.__crgClients = [];

    let fakeClientSequence = 0;
    const fakeSupabase = {
      createClient: (_url, _key, options = {}) => {
          const requestHeaders = { ...(options?.global?.headers || {}) };
          const clientId = ++fakeClientSequence;
          window.__crgClients.push({ id: clientId, headers: requestHeaders });
          return {
            __crgClientId: clientId,
            from: () => {
              const chain = {
                _code: '',
                _columns: '',
                select(columns) { chain._columns = String(columns); return chain; },
                eq(_field, code) { chain._code = String(code); return chain; },
                async maybeSingle() {
                  window.__crgSelectCalls.push({
                    columns: chain._columns,
                    sessionCodeHeader: String(requestHeaders['x-crg-session-code'] || ''),
                  });
                  if (chain._columns !== 'session_code,payload,updated_at,expires_at') {
                    return { data: null, error: { code: '42501', message: 'permission denied' } };
                  }
                  if (String(requestHeaders['x-crg-session-code'] || '') !== chain._code) {
                    return { data: null, error: null };
                  }
                  const row = readSessions()[chain._code];
                  if (!row || Date.parse(row.expiresAt) <= Date.now()) {
                    return { data: null, error: null };
                  }
                  return {
                    data: {
                      session_code: row.session_code,
                      payload: row.payload,
                      updated_at: row.updatedAt,
                      expires_at: row.expiresAt,
                    },
                    error: null,
                  };
                },
                async upsert() {
                  window.__crgDirectWrites += 1;
                  return { data: null, error: { code: '42501', message: 'permission denied' } };
                },
              };
              return chain;
            },
            async rpc(name, args) {
              window.__crgRpcCalls.push({ name, args, clientId });
              if (name !== 'publish_session') {
                return { data: null, error: { code: '42883', message: 'function does not exist' } };
              }
              if (window.__crgFailPublishRpc) {
                return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.publish_session' } };
              }
              if (window.__crgForceRpcError) {
                const error = { code: 'P0001', message: String(window.__crgForceRpcError) };
                window.__crgRpcErrors.push(error);
                return { data: null, error };
              }

              const errors = window.CRG_LIVE_SYNC_ERRORS;
              const code = String(args?.p_code || '');
              const hostKey = String(args?.p_host_key || '');
              const payload = args?.p_payload;

              if (!/^CRG-[A-HJ-NP-Z2-9]{10}$/.test(code)) {
                const error = { code: 'P0001', message: errors.INVALID_SESSION_CODE };
                window.__crgRpcErrors.push(error);
                return { data: null, error };
              }
              if (!hostKey || hostKey.length < 32) {
                const error = { code: 'P0001', message: errors.INVALID_HOST_KEY };
                window.__crgRpcErrors.push(error);
                return { data: null, error };
              }
              if (payload == null) {
                const error = { code: 'P0001', message: errors.PAYLOAD_REQUIRED };
                window.__crgRpcErrors.push(error);
                return { data: null, error };
              }
              const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
              if (payloadBytes > 200000) {
                const error = { code: 'P0001', message: errors.PAYLOAD_TOO_LARGE };
                window.__crgRpcErrors.push(error);
                return { data: null, error };
              }

              const sessions = readSessions();
              const existing = sessions[code];
              if (!existing && Object.keys(sessions).length >= 2000) {
                const error = { code: 'P0001', message: errors.CAPACITY_REACHED };
                window.__crgRpcErrors.push(error);
                return { data: null, error };
              }
              const rawHash = await hashHostKey(hostKey);
              if (existing && (existing.hostKeyHash !== rawHash || Date.parse(existing.expiresAt) <= Date.now())) {
                const error = { code: 'P0001', message: errors.INVALID_HOST_KEY_OR_EXPIRED };
                window.__crgRpcErrors.push(error);
                return { data: null, error };
              }

              await writeSession(code, payload, hostKey, existing?.expiresAt || '');
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
    };
    window.__crgFakeSupabase = fakeSupabase;
    Object.defineProperty(window, 'supabase', {
      configurable: false,
      enumerable: true,
      get: () => fakeSupabase,
      set: () => {},
    });

    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async value => { window.__crgCopiedText = String(value); } },
      });
    } catch {}
  });
}

async function currentSessionCode(page) {
  return (await page.locator('#sessionCodeText').innerText()).match(/CRG-[A-Z0-9]+/)?.[0] || '';
}

async function generateSession(page, playerCount, expectedGames, courts = 1) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(350);
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(playerCount));
  await page.locator('#playerConfirm').click();
  await expect(page.locator('#playerList .player-row')).toHaveCount(playerCount, { timeout: 2500 });
  await page.locator('#courts').fill(String(courts));
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

test('Up Next grid row spacing matches the two-column layout', async ({ page }) => {
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
      rowGaps: (() => {
        const rows = [...new Map(
          rects.map(rect => [Math.round(rect.top), rect])
        ).values()].sort((a,b) => a.top - b.top);
        return rows.slice(1).map((rect, i) => rect.top - rows[i].bottom);
      })(),
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
  expect(metrics.rowGaps.length).toBe(1);
  expect(Math.abs(metrics.rowGaps[0] - 10)).toBeLessThanOrEqual(1);
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
  const liveCode = new URL(liveUrl).searchParams.get('live');
  expect(liveCode).toMatch(/^CRG-[A-HJ-NP-Z2-9]{10}$/);
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('crg-fake-live-sessions-v2') || '{}')).length)).toBeGreaterThan(0);

  const spectator = await context.newPage();
  const sharedSessions = await page.evaluate(() => localStorage.getItem('crg-fake-live-sessions-v2') || '{}');
  await installFakeSupabase(spectator);
  await spectator.goto('/');
  await spectator.evaluate(storage => {
    localStorage.setItem('crg-fake-live-sessions-v2', storage);
  }, sharedSessions);
  await spectator.goto(liveUrl);
  await spectator.waitForLoadState('domcontentloaded');

  await expect(spectator.locator('.spectator-current')).toBeVisible();
  await expect.poll(() => spectator.evaluate(expected => window.__crgSelectCalls?.some(call => call.columns === 'session_code,payload,updated_at,expires_at' && call.sessionCodeHeader === expected) || false, liveCode)).toBeTruthy();
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

test('Restored legacy session code is regenerated before secure RPC publish', async ({ page }) => {
  await installFakeSupabase(page);
  const legacyCode = 'CRG-ABC1234';
  const legacyHostKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  await page.addInitScript(({ legacyCode, legacyHostKey }) => {
    const state = {
      v: 2, savedAt: Date.now(),
      names: ['Alice', 'Bob', 'Carol', 'Dave'],
      active: [1, 2, 3, 4],
      games: [{ court: 1, teams: [[1, 2], [3, 4]], sitting: [] }],
      done: [], results: {}, scores: {}, winByTwo: false, scoreWinByTwo: {},
      locked: [], score: 100, config: { courts: 1, effectiveCourts: 1 },
      sessionCode: legacyCode, playerTargets: {}, playerMeta: {}, gameDurations: {},
      gameStartedAtByIndex: { 0: Date.now() }, gameTimerPaused: false,
      timerPausedIndex: null, waitingCourts: {},
    };
    localStorage.setItem('crg-live-state-v1', JSON.stringify(state));
    localStorage.setItem('crg-supabase-host-key-v1:' + legacyCode, legacyHostKey);
  }, { legacyCode, legacyHostKey });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 5000 });

  const regenerated = await currentSessionCode(page);
  expect(regenerated).toMatch(/^CRG-[A-HJ-NP-Z2-9]{10}$/);
  expect(regenerated).not.toBe(legacyCode);
  expect(await page.evaluate(code => localStorage.getItem('crg-supabase-host-key-v1:' + code), legacyCode)).toBeNull();

  const result = await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
  expect(result?.storageReady).toBeTruthy();
  const call = await page.evaluate(() => window.__crgRpcCalls?.find(x => x.name === 'publish_session'));
  expect(call?.args?.p_code).toBe(regenerated);
  expect(call?.args?.p_host_key).toMatch(/^[0-9a-f]{64}$/);
  expect(call?.args?.p_host_key).not.toBe(legacyHostKey);
  const storedHash = await page.evaluate(code => JSON.parse(localStorage.getItem('crg-fake-live-sessions-v2') || '{}')?.[code]?.hostKeyHash || '', regenerated);
  const expectedHash = await page.evaluate(async key => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }, call?.args?.p_host_key);
  expect(storedHash).toBe(expectedHash);
});

test('RLS returns no rows when the spectator session-code header is missing or wrong', async ({ page }) => {
  await installFakeSupabase(page);
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const result = await page.evaluate(async () => {
    const matching = window.__crgFakeSupabase.createClient('https://fake.supabase.test', 'fake-key', {
      global: { headers: { 'x-crg-session-code': 'CRG-ABCDEFGHJK' } },
    });
    const missing = window.__crgFakeSupabase.createClient('https://fake.supabase.test', 'fake-key');
    const wrong = window.__crgFakeSupabase.createClient('https://fake.supabase.test', 'fake-key', {
      global: { headers: { 'x-crg-session-code': 'CRG-ZZZZZZZZZZ' } },
    });
    await window.__crgSeedLivePayload('CRG-ABCDEFGHJK', { ok: true }, 'a'.repeat(64));
    return {
      matching: await matching.from('court_rotation_sessions').select('session_code,payload,updated_at,expires_at').eq('session_code', 'CRG-ABCDEFGHJK').maybeSingle(),
      missing: await missing.from('court_rotation_sessions').select('session_code,payload,updated_at,expires_at').eq('session_code', 'CRG-ABCDEFGHJK').maybeSingle(),
      wrong: await wrong.from('court_rotation_sessions').select('session_code,payload,updated_at,expires_at').eq('session_code', 'CRG-ABCDEFGHJK').maybeSingle(),
    };
  });

  expect(result.matching.error).toBeNull();
  expect(result.matching.data?.session_code).toBe('CRG-ABCDEFGHJK');
  expect(result.matching.data?.payload).toEqual({ ok: true });
  expect(result.missing.error).toBeNull();
  expect(result.missing.data).toBeNull();
  expect(result.wrong.error).toBeNull();
  expect(result.wrong.data).toBeNull();
});

test('Spectator and table reads cannot request the hidden host key column', async ({ page }) => {
  await installFakeSupabase(page);
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const result = await page.evaluate(async () => {
    const sb = window.__crgFakeSupabase.createClient('https://fake.supabase.test', 'fake-key', {
      global: { headers: { 'x-crg-session-code': 'CRG-ABCDEFGHJK' } },
    });
    const hidden = await sb.from('court_rotation_sessions').select('host_key').eq('session_code', 'CRG-ABCDEFGHJK').maybeSingle();
    const wildcard = await sb.from('court_rotation_sessions').select('*').eq('session_code', 'CRG-ABCDEFGHJK').maybeSingle();
    return { hidden: hidden.error, wildcard: wildcard.error };
  });

  expect(result.hidden?.code).toBe('42501');
  expect(result.wildcard?.code).toBe('42501');
});

test('Secure publish updates an existing session when the raw host key matches', async ({ page }) => {
  await installFakeSupabase(page);
  await generateSession(page, 8, 12);
  await page.waitForTimeout(500);
  const code = await currentSessionCode(page);

  const firstResult = await page.evaluate(async () => {
    window.__crgRpcCalls = [];
    return window.CRG_PUBLISH_LIVE?.();
  });
  expect(firstResult?.storageReady).toBeTruthy();
  const first = await page.evaluate(c => JSON.parse(localStorage.getItem(c) || '{}'), 'crg-fake-live-sessions-v2');
  const firstUpdated = first?.[code]?.updatedAt;
  expect(await page.evaluate(() => window.__crgRpcCalls?.filter(x => x.name === 'publish_session').length || 0)).toBe(1);

  await page.waitForTimeout(25);
  const second = await page.evaluate(async () => {
    window.__crgRpcCalls = [];
    return window.CRG_PUBLISH_LIVE?.();
  });
  expect(second?.storageReady).toBeTruthy();

  const updated = await page.evaluate(c => JSON.parse(localStorage.getItem(c) || '{}'), 'crg-fake-live-sessions-v2');
  expect(updated?.[code]?.updatedAt).not.toBe(firstUpdated);
  expect(await page.evaluate(() => window.__crgDirectWrites || 0)).toBe(0);
  expect(await page.evaluate(() => window.__crgRpcCalls?.filter(x => x.name === 'publish_session').length || 0)).toBe(1);
});

test('Secure publish renews once when the database rejects an ownership or expiry match', async ({ page }) => {
  await installFakeSupabase(page);
  await generateSession(page, 8, 12);
  const originalCode = await currentSessionCode(page);
  const existingHostKey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await page.evaluate(({ originalCode, existingHostKey }) => {
    const sessions = JSON.parse(localStorage.getItem('crg-fake-live-sessions-v2') || '{}');
    sessions[originalCode] = {
      session_code: originalCode, payload: { occupied: true }, hostKey: existingHostKey,
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    localStorage.setItem('crg-fake-live-sessions-v2', JSON.stringify(sessions));
    localStorage.setItem('crg-supabase-host-key-v1:' + originalCode, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  }, { originalCode, existingHostKey });

  const result = await page.evaluate(async () => {
    window.__crgRpcCalls = [];
    return window.CRG_PUBLISH_LIVE?.();
  });
  expect(result?.storageReady).toBeTruthy();

  const calls = await page.evaluate(() => window.__crgRpcCalls?.filter(x => x.name === 'publish_session') || []);
  expect(calls).toHaveLength(2);
  expect(calls[0].args.p_code).toBe(originalCode);
  expect(calls[0].args.p_host_key).not.toBe(existingHostKey);
  expect(calls[1].args.p_code).toMatch(/^CRG-[A-HJ-NP-Z2-9]{10}$/);
  expect(calls[1].args.p_code).not.toBe(originalCode);
  expect(calls[1].args.p_host_key).toMatch(/^[0-9a-f]{64}$/);
  expect(await page.evaluate(() => window.__crgDirectWrites || 0)).toBe(0);
  await expect(page.locator('#crgToast')).toContainText('share the new live link', { timeout: 1000 });
});

test('Capacity reached. shows an unavailable error without regenerating or retrying', async ({ page }) => {
  await installFakeSupabase(page);
  await generateSession(page, 8, 12);
  await page.waitForTimeout(400);

  const original = await page.evaluate(() => ({
    code: (document.querySelector('#sessionCodeText')?.textContent || '').match(/CRG-[A-Z0-9]+/)?.[0] || '',
    hostKey: localStorage.getItem('crg-supabase-host-key-v1:' + ((document.querySelector('#sessionCodeText')?.textContent || '').match(/CRG-[A-Z0-9]+/)?.[0] || '')) || '',
  }));

  await page.evaluate(() => {
    window.__crgRpcCalls = [];
    window.__crgRpcErrors = [];
    window.__crgForceRpcError = window.CRG_LIVE_SYNC_ERRORS.CAPACITY_REACHED;
  });

  const result = await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
  expect(result?.storageReady).toBeFalsy();
  await expect(page.locator('#crgToast')).toContainText('Live sync unavailable', { timeout: 1000 });
  await page.waitForTimeout(650);

  const after = await page.evaluate(code => ({
    code: (document.querySelector('#sessionCodeText')?.textContent || '').match(/CRG-[A-Z0-9]+/)?.[0] || '',
    hostKey: localStorage.getItem('crg-supabase-host-key-v1:' + code) || '',
    rpcCalls: window.__crgRpcCalls?.filter(x => x.name === 'publish_session') || [],
  }), original.code);

  expect(after.code).toBe(original.code);
  expect(after.hostKey).toBe(original.hostKey);
  expect(after.rpcCalls).toHaveLength(1);

  await page.evaluate(() => { window.__crgForceRpcError = ''; });
});

test('Payload too large. shows an error, preserves the code/key, and allows the same code to publish after shrinking', async ({ page }) => {
  await installFakeSupabase(page);
  await generateSession(page, 8, 12);
  await page.waitForTimeout(400);

  const original = await page.evaluate(() => ({
    snapshot: window.CRG_GET_LIVE_SNAPSHOT?.(),
    code: (document.querySelector('#sessionCodeText')?.textContent || '').match(/CRG-[A-Z0-9]+/)?.[0] || '',
  }));
  const originalKey = await page.evaluate(code => localStorage.getItem('crg-supabase-host-key-v1:' + code) || '', original.code);

  await page.evaluate(snapshot => {
    window.__crgRpcCalls = [];
    window.__crgRpcErrors = [];
    window.__crgForceRpcError = window.CRG_LIVE_SYNC_ERRORS.PAYLOAD_TOO_LARGE;
    window.CRG_GET_LIVE_SNAPSHOT = () => ({ ...snapshot, oversizedProbe: 'x'.repeat(200001) });
  }, original.snapshot);

  const rejected = await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
  expect(rejected?.storageReady).toBeFalsy();
  await expect(page.locator('#crgToast')).toContainText('Live sync error · payload too large', { timeout: 1000 });
  await page.waitForTimeout(300);

  const rejectedState = await page.evaluate(code => ({
    code: (document.querySelector('#sessionCodeText')?.textContent || '').match(/CRG-[A-Z0-9]+/)?.[0] || '',
    key: localStorage.getItem('crg-supabase-host-key-v1:' + code) || '',
    rpcCalls: window.__crgRpcCalls?.filter(x => x.name === 'publish_session') || [],
  }), original.code);

  expect(rejectedState.code).toBe(original.code);
  expect(rejectedState.key).toBe(originalKey);
  expect(rejectedState.rpcCalls).toHaveLength(1);

  await page.evaluate(snapshot => {
    window.__crgForceRpcError = '';
    window.CRG_GET_LIVE_SNAPSHOT = () => snapshot;
  }, original.snapshot);

  const published = await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
  expect(published?.storageReady).toBeTruthy();

  const final = await page.evaluate(code => ({
    code: (document.querySelector('#sessionCodeText')?.textContent || '').match(/CRG-[A-Z0-9]+/)?.[0] || '',
    key: localStorage.getItem('crg-supabase-host-key-v1:' + code) || '',
    session: JSON.parse(localStorage.getItem('crg-fake-live-sessions-v2') || '{}')?.[code],
    rpcCalls: window.__crgRpcCalls?.filter(x => x.name === 'publish_session') || [],
  }), original.code);

  expect(final.code).toBe(original.code);
  expect(final.key).toBe(originalKey);
  expect(final.session).toBeTruthy();
  expect(final.rpcCalls).toHaveLength(2);
  expect(final.rpcCalls[0].args.p_code).toBe(original.code);
  expect(final.rpcCalls[0].args.p_host_key).toBe(originalKey);
  expect(final.rpcCalls[1].args.p_code).toBe(original.code);
  expect(final.rpcCalls[1].args.p_host_key).toBe(originalKey);
});

test('Two sessions in one tab use distinct host clients, session headers, and raw keys', async ({ page }) => {
  await installFakeSupabase(page);
  await generateSession(page, 8, 12);
  await page.waitForTimeout(400);

  const sessionA = await page.evaluate(() => {
    const code = (document.querySelector('#sessionCodeText')?.textContent || '').match(/CRG-[A-Z0-9]+/)?.[0] || '';
    const hostKey = localStorage.getItem('crg-supabase-host-key-v1:' + code) || '';
    return { code, hostKey };
  });

  await page.evaluate(() => {
    window.__crgRpcCalls = [];
  });

  const aResult = await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
  expect(aResult?.storageReady).toBeTruthy();
  await expect.poll(() => page.evaluate(() => window.__crgRpcCalls?.filter(x => x.name === 'publish_session').length || 0)).toBe(1);

  const callA = await page.evaluate(() => window.__crgRpcCalls?.find(x => x.name === 'publish_session'));
  expect(callA?.args?.p_code).toBe(sessionA.code);
  expect(callA?.args?.p_host_key).toBe(sessionA.hostKey);
  const aClientId = callA?.clientId;

  const sessionB = await page.evaluate(() => {
    const oldTouch = window.CRG_LIVE_SYNC_TOUCH;
    window.CRG_LIVE_SYNC_TOUCH = () => {};
    const oldCode = (document.querySelector('#sessionCodeText')?.textContent || '').match(/CRG-[A-Z0-9]+/)?.[0] || '';
    const nextCode = window.CRG_RENEW_SESSION_CODE?.();
    window.CRG_LIVE_SYNC_TOUCH = oldTouch;
    const hostKey = localStorage.getItem('crg-supabase-host-key-v1:' + nextCode) || '';
    return { oldCode, code: nextCode, hostKey };
  });

  expect(sessionB.code).toMatch(/^CRG-[A-HJ-NP-Z2-9]{10}$/);
  expect(sessionB.code).not.toBe(sessionA.code);

  await page.evaluate(() => {
    window.__crgRpcCalls = [];
  });

  const bResult = await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
  expect(bResult?.storageReady).toBeTruthy();
  await expect.poll(() => page.evaluate(() => window.__crgRpcCalls?.filter(x => x.name === 'publish_session').length || 0)).toBe(1);

  const details = await page.evaluate(() => ({
    callsB: window.__crgRpcCalls?.filter(x => x.name === 'publish_session') || [],
    clients: window.__crgClients || [],
  }));

  expect(details.callsB).toHaveLength(1);
  expect(details.callsB[0].args.p_code).toBe(sessionB.code);
  expect(details.callsB[0].args.p_host_key).toMatch(/^[0-9a-f]{64}$/);
  expect(details.callsB[0].args.p_host_key).not.toBe(sessionA.hostKey);
  expect(details.callsB[0].clientId).not.toBe(aClientId);

  const aClient = details.clients.find(client => client.id === aClientId);
  const bClient = details.clients.find(client => client.id === details.callsB[0].clientId);
  expect(aClient).toBeTruthy();
  expect(bClient).toBeTruthy();
  expect(aClient.headers['x-crg-session-code']).toBe(sessionA.code);
  expect(bClient.headers['x-crg-session-code']).toBe(sessionB.code);
  expect(bClient.headers['x-crg-host-key']).toBeUndefined();
  expect(details.callsB[0].args.p_host_key).not.toBe(sessionA.hostKey);
});
 
test('Deployed RPC rejects legacy and short host-key inputs without client regeneration', async ({ page }) => {
  await installFakeSupabase(page);
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  const results = await page.evaluate(async () => {
    const sb = window.__crgFakeSupabase.createClient('https://fake.supabase.test', 'fake-key');
    const legacy = await sb.rpc('publish_session', {
      p_code: 'CRG-ABC1234',
      p_host_key: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      p_payload: { ok: true },
    });
    const short = await sb.rpc('publish_session', {
      p_code: 'CRG-ABCDEFGHJK',
      p_host_key: 'short',
      p_payload: { ok: true },
    });
    return { legacy: legacy.error, short: short.error };
  });
  expect(results.legacy?.code).toBe('P0001');
  expect(results.legacy?.message).toBe('Invalid session code.');
  expect(results.short?.code).toBe('P0001');
  expect(results.short?.message).toBe('Invalid host key.');
});

test('Ownership mismatch and expired sessions return the same generic RPC error', async ({ page }) => {
  await installFakeSupabase(page);
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  const result = await page.evaluate(async () => {
    const sb = window.__crgFakeSupabase.createClient('https://fake.supabase.test', 'fake-key');
    const code = 'CRG-ABCDEFGHJK';
    const keyA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const keyB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    await window.__crgSeedLivePayload(code, { owner: 'A' }, keyA);
    const wrongKey = await sb.rpc('publish_session', { p_code: code, p_host_key: keyB, p_payload: { owner: 'B' } });
    await window.__crgSeedLivePayload(code, { owner: 'expired' }, keyA, new Date(Date.now() - 1000).toISOString());
    const expired = await sb.rpc('publish_session', { p_code: code, p_host_key: keyA, p_payload: { owner: 'B' } });
    return { wrongKey: wrongKey.error, expired: expired.error };
  });
  expect(result.wrongKey?.code).toBe('P0001');
  expect(result.wrongKey?.message).toBe('Invalid host key or expired session.');
  expect(result.expired?.code).toBe('P0001');
  expect(result.expired?.message).toBe('Invalid host key or expired session.');
});

test('Live publish never falls back to a direct table write when the RPC is unavailable', async ({ page }) => {
  await installFakeSupabase(page);
  await generateSession(page, 8, 12);
  await page.evaluate(() => { window.__crgFailPublishRpc = true; });
  const result = await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
  expect(result?.storageReady).toBeFalsy();
  expect(await page.evaluate(() => window.__crgDirectWrites || 0)).toBe(0);
  await expect(page.locator('#crgToast')).toContainText('Live sync unavailable', { timeout: 1000 });
});

test('Live publish waits for runtime Supabase config before sending the first RPC', async ({ page }) => {
  await installFakeSupabase(page, { delay: 1000 });
  await generateSession(page, 8, 12);

  await expect.poll(() => page.evaluate(() => window.__crgRpcCalls?.length || 0), { timeout: 400 }).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__crgRpcCalls?.filter(x => x.name === 'publish_session').length || 0), { timeout: 1800 }).toBeGreaterThan(0);
});

test('Unconfigured runtime Supabase disables live sync without publishing anywhere', async ({ page }) => {
  await installFakeSupabase(page, {
    delay: 50,
    config: { configured: false, url: '', publishableKey: '', source: 'vercel-env' },
  });
  await generateSession(page, 8, 12);

  await expect(page.locator('#copyLiveSpectatorBtn')).toHaveText('Live sync unavailable', { timeout: 1500 });
  expect(await page.evaluate(() => window.__crgRpcCalls?.length || 0)).toBe(0);
  await expect(page.locator('#crgToast')).toContainText('Live sync unavailable', { timeout: 1000 });
});

test('Transient publish failures use exponential jitter and pause while hidden or offline', async ({ page }) => {
  await installFakeSupabase(page);
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(350);

  await page.evaluate(() => {
    const originalSetTimeout = window.setTimeout;
    window.__crgRetryDelays = [];
    window.__crgRetryCallbacks = [];
    window.setTimeout = (fn, delay, ...args) => {
      if (Number(delay) >= 250) {
        window.__crgRetryDelays.push(Number(delay));
        if (Number(delay) !== 7000) window.__crgRetryCallbacks.push(() => fn(...args));
        return 987654;
      }
      return originalSetTimeout(fn, delay, ...args);
    };
    window.__crgRestoreSetTimeout = () => { window.setTimeout = originalSetTimeout; };
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.__crgForceRpcError = 'Transient failure';
    window.__crgRpcCalls = [];
  });

  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(8));
  await page.locator('#playerConfirm').click();
  await expect(page.locator('#playerList .player-row')).toHaveCount(8, { timeout: 2500 });
  await page.locator('#generateBtn').click();
  await expect(page.locator('#setupStatus')).toContainText('Rotation ready', { timeout: 8000 });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    window.__crgRetryDelays = [];
    window.__crgRetryCallbacks = [];
    window.__crgRpcCalls = [];
  });

  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.(true));
  }

  const result = await page.evaluate(async () => {
    const delays = (window.__crgRetryDelays || []).filter(delay => delay !== 7000);
    const activeRetryCallback = (window.__crgRetryCallbacks || []).at(-1);
    const callsBeforePause = window.__crgRpcCalls.length;

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    activeRetryCallback?.();
    await Promise.resolve();
    const callsAfterHiddenTimer = window.__crgRpcCalls.length;

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    const callsWhileOffline = window.__crgRpcCalls.length;

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
    await new Promise(resolve => setTimeout(resolve, 0));

    return {
      delays,
      callsBeforePause,
      callsAfterHiddenTimer,
      callsWhileOffline,
      callsAfterOnline: window.__crgRpcCalls.length,
    };
  });

  expect(result.delays.length).toBeGreaterThanOrEqual(3);
  expect(result.delays[1]).toBeGreaterThan(result.delays[0]);
  expect(result.delays[2]).toBeGreaterThan(result.delays[1]);
  expect(result.delays[1] / result.delays[0]).toBeGreaterThanOrEqual(1.33);
  expect(result.delays[1] / result.delays[0]).toBeLessThanOrEqual(3.0);
  expect(result.delays[2] / result.delays[1]).toBeGreaterThanOrEqual(1.33);
  expect(result.delays[2] / result.delays[1]).toBeLessThanOrEqual(3.0);
  expect(result.callsAfterHiddenTimer).toBe(result.callsBeforePause);
  expect(result.callsWhileOffline).toBe(result.callsBeforePause);
  expect(result.callsAfterOnline).toBe(result.callsBeforePause + 1);
  await page.evaluate(() => window.__crgRestoreSetTimeout?.());
});

test('Spectator shows Session ended for a missing or expired live session', async ({ page }) => {
  await installFakeSupabase(page);
  await page.goto('/?live=CRG-ABCDEFGHJK&view=spectator');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('.spectator-ended')).toBeVisible();
  await expect(page.locator('.spectator-ended h1')).toHaveText('Session ended');
  await expect(page.locator('.spectator-ended')).toContainText('no longer available');
  expect(await page.evaluate(() => window.__crgSelectCalls?.at(-1)?.columns)).toBe('session_code,payload,updated_at,expires_at');
});

test('Failed runtime Supabase config disables live sync without publishing anywhere', async ({ page }) => {
  await installFakeSupabase(page, { configError: true });
  await generateSession(page, 8, 12);
  await expect(page.locator('#copyLiveSpectatorBtn')).toHaveText('Live sync unavailable', { timeout: 1500 });
  expect(await page.evaluate(() => window.__crgRpcCalls?.length || 0)).toBe(0);
  await expect(page.locator('#crgToast')).toContainText('Live sync unavailable', { timeout: 1000 });
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
  const sharedSessions = await page.evaluate(() => localStorage.getItem('crg-fake-live-sessions-v2') || '{}');
  await installFakeSupabase(shared);
  await shared.goto('/');
  await shared.evaluate(storage => {
    localStorage.setItem('crg-fake-live-sessions-v2', storage);
  }, sharedSessions);
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


test('Two-court live spectator keeps both courts synchronized through results', async ({ page, context }) => {
  await installFakeSupabase(page);
  await generateSession(page, 12, 18, 2);
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => {
    const snapshot = window.CRG_GET_LIVE_SNAPSHOT?.();
    return {
      version: snapshot?.version,
      courts: snapshot?.courts || [],
      sessionCode: snapshot?.sessionCode || '',
    };
  });
  expect(before.version).toBe(8);
  expect(before.courts).toHaveLength(2);
  expect(before.courts.every(court => Number.isFinite(Number(court.court)))).toBeTruthy();
  expect(before.courts.filter(court => court.status === 'playing').length).toBeGreaterThanOrEqual(2);

  await page.locator('#copyLiveSpectatorBtn').click();
  await expect.poll(() => page.evaluate(() => window.__crgCopiedText || '')).toMatch(/(?:\?|&)live=CRG-[A-Z0-9]+/);
  const liveUrl = await page.evaluate(() => window.__crgCopiedText);

  const spectator = await context.newPage();
  const sharedSessions = await page.evaluate(() => localStorage.getItem('crg-fake-live-sessions-v2') || '{}');
  await installFakeSupabase(spectator);
  await spectator.goto('/');
  await spectator.evaluate(storage => {
    localStorage.setItem('crg-fake-live-sessions-v2', storage);
  }, sharedSessions);
  await spectator.goto(liveUrl);
  await spectator.waitForLoadState('domcontentloaded');

  await expect(spectator.locator('.spectator-court-card')).toHaveCount(2);
  const initialCourt2Game = await spectator.locator('[data-spectator-court="2"] h2').innerText();
  const initialCourt2Players = await spectator.locator('[data-spectator-court="2"] .spectator-court-matchup .spectator-player-name').evaluateAll(nodes =>
    nodes.map(node => (node.childNodes[0]?.textContent || node.textContent || '').replace(/\s+$/, '').trim())
  );

  const court1Button = page.locator('#courtCards [data-action="complete"][data-court="1"]');
  await expect(court1Button).toBeEnabled({ timeout: 5000 });
  await court1Button.click();
  await expect(page.locator('[data-winner="0"]')).toBeVisible({ timeout: 5000 });
  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();

  await expect.poll(() => spectator.locator('.spectator-court-card').count(), { timeout: 7000 }).toBe(2);
  await expect(spectator.locator('[data-spectator-court="2"]')).toBeVisible();
  await expect(spectator.locator('[data-spectator-court="2"] h2')).toHaveText(initialCourt2Game, { timeout: 7000 });
  await expect.poll(
    () => spectator.locator('[data-spectator-court="2"] .spectator-court-matchup .spectator-player-name').evaluateAll(nodes =>
      nodes.map(node => (node.childNodes[0]?.textContent || node.textContent || '').replace(/\s+$/, '').trim())
    ),
    { timeout: 7000 }
  ).toEqual(initialCourt2Players);

  await spectator.close();

  const lateSpectator = await context.newPage();
  await installFakeSupabase(lateSpectator);
  await lateSpectator.goto('/');
  const midSessionStorage = await page.evaluate(() => localStorage.getItem('crg-fake-live-sessions-v2') || '{}');
  await lateSpectator.evaluate(storage => {
    localStorage.setItem('crg-fake-live-sessions-v2', storage);
  }, midSessionStorage);
  await lateSpectator.goto(liveUrl);
  await lateSpectator.waitForLoadState('domcontentloaded');
  await expect(lateSpectator.locator('.spectator-court-card')).toHaveCount(2);
  await expect(lateSpectator.locator('[data-spectator-court="2"]')).toBeVisible();

  const court2Button = page.locator('#courtCards [data-action="complete"][data-court="2"]');
  await expect(court2Button).toBeEnabled({ timeout: 5000 });
  await court2Button.click();
  await expect(page.locator('[data-winner="0"]')).toBeVisible({ timeout: 5000 });
  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('8');
  await page.locator('#scoreConfirm').click();

  await expect.poll(() => lateSpectator.locator('.spectator-court-card').count(), { timeout: 7000 }).toBe(2);
  await expect(lateSpectator.locator('[data-spectator-court="1"]')).toBeVisible();
  await expect(lateSpectator.locator('[data-spectator-court="2"]')).toBeVisible();

  await lateSpectator.close();
});

test('Version 7 spectator payload keeps the legacy single-court rendering path', async ({ page, context }) => {
  await installFakeSupabase(page);
  await generateSession(page, 8, 12);
  await page.waitForTimeout(400);

  const snapshot = await page.evaluate(() => window.CRG_GET_LIVE_SNAPSHOT?.());
  const legacy = { ...snapshot, version: 7 };
  delete legacy.courts;

  const spectator = await context.newPage();
  await installFakeSupabase(spectator);
  await spectator.goto('/');
  await spectator.evaluate(({ code, payload }) => {
    return window.__crgSeedLivePayload(code, payload, 'a'.repeat(64));
  }, { code: snapshot.sessionCode, payload: legacy });
  const liveUrl = '/?live=' + encodeURIComponent(snapshot.sessionCode) + '&view=spectator';
  await spectator.goto(liveUrl);
  await spectator.waitForLoadState('domcontentloaded');

  await expect(spectator.locator('.spectator-current')).toBeVisible();
  await expect(spectator.locator('.spectator-current h2')).toHaveText(snapshot.current.game);
  await expect(spectator.locator('.spectator-court-card')).toHaveCount(0);
  await spectator.close();
});
