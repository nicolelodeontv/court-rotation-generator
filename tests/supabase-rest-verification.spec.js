const { test, expect } = require('@playwright/test');

const RUN_REAL = process.env.CRG_RUN_SUPABASE_REAL === '1';
const SUPABASE_URL = String(process.env.CRG_SUPABASE_URL || '').replace(/\/$/, '');
const PUBLISHABLE_KEY = String(process.env.CRG_SUPABASE_PUBLISHABLE_KEY || '');
const TABLE = 'court_rotation_sessions';

function redact(value, secrets = []) {
  let out = String(value ?? '');
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('[redacted]');
  }
  return out;
}

async function rest(request, method, path, { headers = {}, data } = {}) {
  return request.fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${PUBLISHABLE_KEY}`,
      ...headers,
    },
    data,
  });
}

test('real Supabase security and browser verification', async ({ page, request }) => {
  test.skip(!RUN_REAL, 'Set CRG_RUN_SUPABASE_REAL=1 to run against the real Supabase project.');
  test.skip(!SUPABASE_URL || !PUBLISHABLE_KEY, 'Set CRG_SUPABASE_URL and CRG_SUPABASE_PUBLISHABLE_KEY.');
  test.setTimeout(60000);

  const corsPreflights = [];
  page.on('response', response => {
    const req = response.request();
    if (req.method() === 'OPTIONS' && response.url().startsWith(`${SUPABASE_URL}/rest/`)) {
      corsPreflights.push({
        url: response.url(),
        status: response.status(),
        headers: response.headers(),
      });
    }
  });

  await page.route('**/api/live-config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      configured: true,
      url: SUPABASE_URL,
      publishableKey: PUBLISHABLE_KEY,
      source: 'verification-env',
    }),
  }));

  await page.goto('/');

  const names = Array.from({ length: 24 }, (_, i) => `Player ${String(i + 1).padStart(2, '0')}`);
  await page.locator('#names').fill(names.join('\n'));
  await page.locator('#generate').click();
  await expect(page.locator('.game-match')).toHaveCount(36, { timeout: 10000 });

  let sessionCode = await page.locator('#sessionCodeText').textContent();
  let code = String(sessionCode || '').match(/CRG-[A-Z0-9]+/)?.[0] || '';
  expect(code).toMatch(/^CRG-[A-HJ-NP-Z2-9]{10}$/);

  let hostKey = await page.evaluate(currentCode =>
    localStorage.getItem('crg-supabase-host-key-v1:' + currentCode) || '',
  code);
  expect(hostKey).toMatch(/^[0-9a-f]{64}$/);

  console.log(`CREATED_SESSION_CODE ${code}`);

  const secrets = [PUBLISHABLE_KEY, hostKey];
  const resultLines = [];
  const failures = [];

  async function check(name, fn) {
    try {
      const detail = await fn();
      resultLines.push(`PASS · ${name}${detail ? ` · ${redact(detail, secrets)}` : ''}`);
    } catch (error) {
      const detail = redact(error?.message || error, secrets);
      resultLines.push(`FAIL · ${name} · ${detail}`);
      failures.push(name);
    }
  }

  const basePath = currentCode =>
    `/rest/v1/${TABLE}?select=payload%2Cupdated_at&session_code=eq.${encodeURIComponent(currentCode)}`;

  await check('correct-key publish succeeds through live-sync.js', async () => {
    const publishResult = await page.evaluate(async () => {
      const result = await window.CRG_PUBLISH_LIVE?.();
      return result || null;
    });
    if (publishResult?.storageReady !== true) {
      throw new Error('CRG_PUBLISH_LIVE did not report storageReady=true.');
    }

    const response = await rest(request, 'GET', basePath(code), {
      headers: { 'x-crg-session-code': code },
    });
    if (!response.ok()) throw new Error(`HTTP ${response.status()} ${await response.text()}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.payload?.sessionCode) {
      throw new Error('Live-sync row was not found after publish.');
    }
    if (Object.prototype.hasOwnProperty.call(rows[0], 'host_key')) {
      throw new Error('Live-sync read returned host_key.');
    }
  });

  await check('host_key SELECT is denied', async () => {
    const response = await rest(
      request,
      'GET',
      `/rest/v1/${TABLE}?select=host_key&session_code=eq.${encodeURIComponent(code)}`,
      { headers: { 'x-crg-session-code': code } },
    );
    if (response.ok()) throw new Error('host_key SELECT unexpectedly succeeded.');
  });

  await check('select=* excludes host_key', async () => {
    const response = await rest(
      request,
      'GET',
      `/rest/v1/${TABLE}?select=*&session_code=eq.${encodeURIComponent(code)}`,
      { headers: { 'x-crg-session-code': code } },
    );
    if (response.ok()) {
      const rows = await response.json();
      if (Array.isArray(rows) && rows.some(row => Object.prototype.hasOwnProperty.call(row, 'host_key'))) {
        throw new Error('Wildcard SELECT returned host_key.');
      }
      return 'wildcard SELECT returned only permitted columns';
    }
  });

  await check('wrong or missing session code returns zero rows', async () => {
    const wrong = await rest(request, 'GET', basePath(code), {
      headers: { 'x-crg-session-code': 'CRG-' + 'A'.repeat(10) },
    });
    if (!wrong.ok()) throw new Error(`wrong-code HTTP ${wrong.status()} ${await wrong.text()}`);
    const wrongRows = await wrong.json();
    if (!Array.isArray(wrongRows) || wrongRows.length !== 0) {
      throw new Error(`wrong-code expected 0 rows, got ${wrongRows.length}`);
    }

    const missing = await rest(request, 'GET', basePath(code));
    if (!missing.ok()) throw new Error(`missing-code HTTP ${missing.status()} ${await missing.text()}`);
    const missingRows = await missing.json();
    if (!Array.isArray(missingRows) || missingRows.length !== 0) {
      throw new Error(`missing-code expected 0 rows, got ${missingRows.length}`);
    }
  });

  await check('malformed session code is rejected', async () => {
    const badCode = 'CRG-' + 'A'.repeat(9) + '!';
    const response = await rest(request, 'POST', '/rest/v1/rpc/publish_session', {
      headers: {
        'x-crg-session-code': badCode,
        'x-crg-host-key': hostKey,
        'Content-Type': 'application/json',
      },
      data: { p_code: badCode, p_host_key: hostKey, p_payload: { test: true } },
    });
    if (response.ok()) throw new Error('Malformed session code unexpectedly succeeded.');
  });

  await check('oversized payload is rejected', async () => {
    const oversized = { blob: 'X'.repeat(200001) };
    const response = await rest(request, 'POST', '/rest/v1/rpc/publish_session', {
      headers: {
        'x-crg-session-code': code,
        'x-crg-host-key': hostKey,
        'Content-Type': 'application/json',
      },
      data: { p_code: code, p_host_key: hostKey, p_payload: oversized },
    });
    if (response.ok()) throw new Error('Oversize payload unexpectedly succeeded.');
  });

  await check('wrong host key cannot update the live session', async () => {
    const wrongHostKey = 'f'.repeat(64);
    const response = await rest(request, 'POST', '/rest/v1/rpc/publish_session', {
      headers: {
        'x-crg-session-code': code,
        'x-crg-host-key': wrongHostKey,
        'Content-Type': 'application/json',
      },
      data: { p_code: code, p_host_key: wrongHostKey, p_payload: { tampered: true } },
    });
    if (response.ok()) throw new Error('Wrong host key unexpectedly succeeded.');
  });

  await check('delete is rejected for publishable-key clients', async () => {
    const response = await rest(
      request,
      'DELETE',
      `/rest/v1/${TABLE}?session_code=eq.${encodeURIComponent(code)}`,
      { headers: { 'x-crg-session-code': code } },
    );
    if (response.ok()) throw new Error('DELETE unexpectedly succeeded.');
  });

  await check('browser CORS allows x-crg-session-code', async () => {
    const browserResult = await page.evaluate(async ({ url, key, currentCode, currentHostKey }) => {
      try {
        const response = await fetch(
          url + '/rest/v1/court_rotation_sessions?select=payload&session_code=eq.' +
            encodeURIComponent(currentCode),
          {
            method: 'GET',
            headers: {
              apikey: key,
              Authorization: 'Bearer ' + key,
              'x-crg-session-code': currentCode,
              'x-crg-host-key': currentHostKey,
            },
          },
        );
        return { ok: response.ok, status: response.status, body: await response.text() };
      } catch (error) {
        return { ok: false, status: 0, body: String(error?.message || error) };
      }
    }, {
      url: SUPABASE_URL,
      key: PUBLISHABLE_KEY,
      currentCode: code,
      currentHostKey: hostKey,
    });

    if (!browserResult.ok) {
      throw new Error(`Browser fetch failed HTTP ${browserResult.status}: ${browserResult.body}`);
    }

    const preflight = corsPreflights[corsPreflights.length - 1];
    if (!preflight) throw new Error('No REST preflight response was observed.');
    const allowHeaders = String(preflight.headers['access-control-allow-headers'] || '').toLowerCase();
    if (!allowHeaders.includes('x-crg-session-code')) {
      throw new Error('CORS response omitted x-crg-session-code.');
    }
    if (!String(preflight.headers['access-control-allow-origin'] || '')) {
      throw new Error('CORS response omitted access-control-allow-origin.');
    }
    return `OPTIONS HTTP ${preflight.status}; allow-headers=${preflight.headers['access-control-allow-headers'] || '(none)'}`;
  });

  await check('40-player, 40-character roster publishes under payload cap', async () => {
    const names40 = Array.from({ length: 40 }, (_, i) => `P${String(i + 1).padStart(2, '0')} ${'X'.repeat(36)}`);
    await page.locator('#names').fill(names40.join('\n'));
    await page.locator('#generate').click();
    await expect(page.locator('.player-row')).toHaveCount(40, { timeout: 10000 });

    const visibleNames = await page.locator('.player-row .player-name').evaluateAll(nodes =>
      nodes.map(node => node.textContent.trim())
    );
    if (visibleNames.length !== 40) throw new Error(`Expected 40 visible players, got ${visibleNames.length}.`);
    const maxNameLength = Math.max(...visibleNames.map(value => [...value].length));
    if (maxNameLength > 40) throw new Error(`Roster contains a name longer than 40 characters: ${maxNameLength}.`);

    const nextSessionCode = await page.locator('#sessionCodeText').textContent();
    const nextCode = String(nextSessionCode || '').match(/CRG-[A-Z0-9]+/)?.[0] || '';
    if (!/^CRG-[A-HJ-NP-Z2-9]{10}$/.test(nextCode)) {
      throw new Error('40-player generation did not produce a valid session code.');
    }

    const nextHostKey = await page.evaluate(currentCode =>
      localStorage.getItem('crg-supabase-host-key-v1:' + currentCode) || '',
    nextCode);
    if (!/^[0-9a-f]{64}$/.test(nextHostKey)) throw new Error('40-player session host key is invalid.');

    console.log(`CREATED_SESSION_CODE ${nextCode}`);

    const publishResult = await page.evaluate(async () => {
      const result = await window.CRG_PUBLISH_LIVE?.();
      return result || null;
    });
    if (publishResult?.storageReady !== true) {
      throw new Error('40-player live publish did not report storageReady=true.');
    }

    const response = await rest(request, 'GET', basePath(nextCode), {
      headers: { 'x-crg-session-code': nextCode },
    });
    if (!response.ok()) throw new Error(`HTTP ${response.status()} ${await response.text()}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.payload) {
      throw new Error('40-player live row was not found after publish.');
    }

    const payloadBytes = Buffer.byteLength(JSON.stringify(rows[0].payload), 'utf8');
    if (payloadBytes > 200000) {
      throw new Error(`Payload is ${payloadBytes} bytes, over the 200000-byte cap.`);
    }
    const payloadNames = Array.isArray(rows[0].payload.names) ? rows[0].payload.names : [];
    if (payloadNames.length !== 40) throw new Error(`Published payload contains ${payloadNames.length} names, expected 40.`);
    if (Math.max(...payloadNames.map(name => [...String(name)].length)) > 40) {
      throw new Error('Published payload contains a name longer than 40 characters.');
    }

    sessionCode = nextSessionCode;
    code = nextCode;
    hostKey = nextHostKey;
    secrets.splice(0, secrets.length, PUBLISHABLE_KEY, hostKey);
    return `payload=${payloadBytes} bytes; players=${payloadNames.length}`;
  });

  for (const line of resultLines) console.log(line);
  expect(failures, `Supabase verification failed: ${failures.join(', ')}`).toEqual([]);
});
