const { test, expect } = require('@playwright/test');
const { randomBytes } = require('crypto');

const RUN_REAL = process.env.CRG_RUN_SUPABASE_REAL === '1';
const SUPABASE_URL = String(process.env.CRG_SUPABASE_URL || '').replace(/\/$/, '');
const PUBLISHABLE_KEY = String(process.env.CRG_SUPABASE_PUBLISHABLE_KEY || '');
const TABLE = 'court_rotation_sessions';
const createdCodes = [];

function redact(value, secrets = []) {
  let out = String(value ?? '');
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('[redacted]');
  }
  return out;
}

function firstLine(value) {
  return String(value ?? '').split(/\r?\n/, 1)[0];
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

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  let code = '';
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return `CRG-${code}`;
}

function makeHostKey() {
  return randomBytes(32).toString('hex');
}

async function createSession(request, payload = {
  names: ['Alice', 'Bob', 'Carol', 'Dave'],
}) {
  const code = makeCode();
  const hostKey = makeHostKey();
  const response = await rest(request, 'POST', '/rest/v1/rpc/publish_session', {
    headers: {
      'x-crg-session-code': code,
      'x-crg-host-key': hostKey,
      'Content-Type': 'application/json',
    },
    data: {
      p_code: code,
      p_host_key: hostKey,
      p_payload: { ...payload, sessionCode: code },
    },
  });
  if (!response.ok()) {
    throw new Error(`create-session HTTP ${response.status()} ${firstLine(await response.text())}`);
  }
  createdCodes.push(code);
  return { code, hostKey };
}

async function pasteNames(page, names) {
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(names.join('\n'));
  await page.locator('#playerConfirm').click();
}

async function reportCheck(name, getSecrets, fn) {
  try {
    const detail = await fn();
    console.log(`PASS ${name}${detail ? ` · ${redact(detail, getSecrets())}` : ''}`);
  } catch (error) {
    const detail = redact(firstLine(error?.message || error), getSecrets());
    console.log(`FAIL ${name}: ${detail}`);
    throw error;
  }
}

test.skip(!RUN_REAL || !SUPABASE_URL || !PUBLISHABLE_KEY,
  'Set CRG_RUN_SUPABASE_REAL=1, CRG_SUPABASE_URL, and CRG_SUPABASE_PUBLISHABLE_KEY to run real verification.'
);

test.describe('Real Supabase verification', () => {
  test.setTimeout(60000);

  test('host_key denied', async ({ request }) => {
    let hostKey = '';
    let code = '';
    await reportCheck('host_key denied', () => [PUBLISHABLE_KEY, hostKey], async () => {
      ({ code, hostKey } = await createSession(request));
      const response = await rest(request, 'GET',
        `/rest/v1/${TABLE}?select=host_key&session_code=eq.${encodeURIComponent(code)}`,
        { headers: { 'x-crg-session-code': code } }
      );
      if (response.ok()) throw new Error('host_key SELECT unexpectedly succeeded.');
      return `HTTP ${response.status()}`;
    });
  });

  test('select=* excludes host_key', async ({ request }) => {
    let hostKey = '';
    let code = '';
    await reportCheck('select=* excludes host_key', () => [PUBLISHABLE_KEY, hostKey], async () => {
      ({ code, hostKey } = await createSession(request));
      const response = await rest(request, 'GET',
        `/rest/v1/${TABLE}?select=*&session_code=eq.${encodeURIComponent(code)}`,
        { headers: { 'x-crg-session-code': code } }
      );
      if (!response.ok()) return `HTTP ${response.status()} ${firstLine(await response.text())}`;
      const rows = await response.json();
      if (rows.some(row => Object.prototype.hasOwnProperty.call(row, 'host_key'))) {
        throw new Error('Wildcard SELECT returned host_key.');
      }
      return 'wildcard SELECT returned no host_key';
    });
  });

  test('wrong or missing session code returns zero rows', async ({ request }) => {
    let hostKey = '';
    let code = '';
    await reportCheck('wrong or missing session code returns zero rows', () => [PUBLISHABLE_KEY, hostKey], async () => {
      ({ code, hostKey } = await createSession(request));
      const path = `/rest/v1/${TABLE}?select=payload%2Cupdated_at&session_code=eq.${encodeURIComponent(code)}`;

      const wrong = await rest(request, 'GET', path, {
        headers: { 'x-crg-session-code': 'CRG-' + 'A'.repeat(10) },
      });
      if (!wrong.ok()) throw new Error(`wrong-code HTTP ${wrong.status()} ${firstLine(await wrong.text())}`);
      const wrongRows = await wrong.json();
      if (wrongRows.length !== 0) throw new Error(`wrong-code expected 0 rows, got ${wrongRows.length}`);

      const missing = await rest(request, 'GET', path);
      if (!missing.ok()) throw new Error(`missing-code HTTP ${missing.status()} ${firstLine(await missing.text())}`);
      const missingRows = await missing.json();
      if (missingRows.length !== 0) throw new Error(`missing-code expected 0 rows, got ${missingRows.length}`);
      return 'wrong=0 rows; missing=0 rows';
    });
  });

  test('malformed code rejected', async ({ request }) => {
    let hostKey = '';
    await reportCheck('malformed code rejected', () => [PUBLISHABLE_KEY, hostKey], async () => {
      ({ hostKey } = await createSession(request));
      const badCode = 'CRG-' + 'A'.repeat(9) + '!';
      const response = await rest(request, 'POST', '/rest/v1/rpc/publish_session', {
        headers: {
          'x-crg-session-code': badCode,
          'x-crg-host-key': hostKey,
          'Content-Type': 'application/json',
        },
        data: {
          p_code: badCode,
          p_host_key: hostKey,
          p_payload: { test: true },
        },
      });
      if (response.ok()) throw new Error('Malformed session code unexpectedly succeeded.');
      return `HTTP ${response.status()}`;
    });
  });

  test('oversized payload rejected', async ({ request }) => {
    let hostKey = '';
    let code = '';
    await reportCheck('oversized payload rejected', () => [PUBLISHABLE_KEY, hostKey], async () => {
      ({ code, hostKey } = await createSession(request));
      const response = await rest(request, 'POST', '/rest/v1/rpc/publish_session', {
        headers: {
          'x-crg-session-code': code,
          'x-crg-host-key': hostKey,
          'Content-Type': 'application/json',
        },
        data: {
          p_code: code,
          p_host_key: hostKey,
          p_payload: { blob: 'X'.repeat(200001) },
        },
      });
      if (response.ok()) throw new Error('Oversize payload unexpectedly succeeded.');
      return `HTTP ${response.status()}`;
    });
  });

  test('wrong-key update rejected', async ({ request }) => {
    let hostKey = '';
    let code = '';
    await reportCheck('wrong-key update rejected', () => [PUBLISHABLE_KEY, hostKey], async () => {
      ({ code, hostKey } = await createSession(request));
      const wrongHostKey = 'f'.repeat(64);
      const response = await rest(request, 'POST', '/rest/v1/rpc/publish_session', {
        headers: {
          'x-crg-session-code': code,
          'x-crg-host-key': wrongHostKey,
          'Content-Type': 'application/json',
        },
        data: {
          p_code: code,
          p_host_key: wrongHostKey,
          p_payload: { tampered: true },
        },
      });
      if (response.ok()) throw new Error('Wrong host key unexpectedly succeeded.');
      return `HTTP ${response.status()}`;
    });
  });

  test('delete rejected', async ({ request }) => {
    let hostKey = '';
    let code = '';
    await reportCheck('delete rejected', () => [PUBLISHABLE_KEY, hostKey], async () => {
      ({ code, hostKey } = await createSession(request));
      const response = await rest(request, 'DELETE',
        `/rest/v1/${TABLE}?session_code=eq.${encodeURIComponent(code)}`,
        { headers: { 'x-crg-session-code': code } }
      );
      if (response.ok()) throw new Error('DELETE unexpectedly succeeded.');
      return `HTTP ${response.status()}`;
    });
  });

  test('browser CORS allows x-crg-session-code', async ({ request }) => {
    await reportCheck('browser CORS allows x-crg-session-code', () => [PUBLISHABLE_KEY], async () => {
      const response = await request.fetch(
        `${SUPABASE_URL}/rest/v1/${TABLE}?select=payload`,
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://court-rotation-generator.vercel.app',
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'apikey,authorization,x-crg-session-code',
          },
        }
      );
      const allowHeaders = String(response.headers()['access-control-allow-headers'] || '').toLowerCase();
      const allowOrigin = String(response.headers()['access-control-allow-origin'] || '');
      if (!allowHeaders.includes('x-crg-session-code')) {
        throw new Error('CORS response omitted x-crg-session-code.');
      }
      if (!allowOrigin) throw new Error('CORS response omitted access-control-allow-origin.');
      return `OPTIONS HTTP ${response.status()}; allow-headers=${response.headers()['access-control-allow-headers'] || '(none)'}`;
    });
  });

  test('correct-key publish succeeds (end to end through live-sync.js)', async ({ page, request }) => {
    let hostKey = '';
    await reportCheck(
      'correct-key publish succeeds (end to end through live-sync.js)',
      () => [PUBLISHABLE_KEY, hostKey],
      async () => {
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
        await pasteNames(page, Array.from({ length: 24 }, (_, i) => `Player ${String(i + 1).padStart(2, '0')}`));
        await page.locator('#generateBtn').click();
        await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 10000 });

        const label = await page.locator('#sessionCodeText').textContent();
        const code = String(label || '').match(/CRG-[A-Z0-9]+/)?.[0] || '';
        expect(code).toMatch(/^CRG-[A-HJ-NP-Z2-9]{10}$/);

        createdCodes.push(code);

        const publishResult = await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
        if (publishResult?.storageReady !== true) {
          throw new Error('CRG_PUBLISH_LIVE did not report storageReady=true.');
        }

        hostKey = await page.evaluate(currentCode =>
          localStorage.getItem('crg-supabase-host-key-v1:' + currentCode) || '', code
        );
        expect(hostKey).toMatch(/^[0-9a-f]{64}$/);

        const response = await rest(request, 'GET',
          `/rest/v1/${TABLE}?select=payload%2Cupdated_at&session_code=eq.${encodeURIComponent(code)}`,
          { headers: { 'x-crg-session-code': code } }
        );
        if (!response.ok()) throw new Error(`HTTP ${response.status()} ${firstLine(await response.text())}`);
        const rows = await response.json();
        if (rows.length !== 1 || !rows[0]?.payload?.sessionCode) {
          throw new Error('Live-sync row was not found after publish.');
        }
        return 'row verified through anon REST read';
      }
    );
  });

  test('40-player, 40-character roster publishes under the payload cap', async ({ page, request }) => {
    let hostKey = '';
    await reportCheck(
      '40-player, 40-character roster publishes under the payload cap',
      () => [PUBLISHABLE_KEY, hostKey],
      async () => {
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
        const names40 = Array.from(
          { length: 40 },
          (_, i) => `P${String(i + 1).padStart(2, '0')} ${'X'.repeat(36)}`
        );
        await pasteNames(page, names40);
        await expect(page.locator('#playerList .player-row')).toHaveCount(40, { timeout: 10000 });

        const visibleNames = await page.locator('#playerList .player-name').evaluateAll(nodes =>
          nodes.map(node => node.textContent.trim())
        );
        if (visibleNames.length !== 40) throw new Error(`Expected 40 visible players, got ${visibleNames.length}.`);
        const nameLengths = visibleNames.map(value => [...value].length);
        if (nameLengths.some(length => length !== 40)) {
          throw new Error(`Expected every visible player name to be exactly 40 characters; lengths=${nameLengths.join(',')}.`);
        }

        await page.locator('#generateBtn').click();
        await expect(page.locator('#currentNo')).toHaveText('GAME 1', { timeout: 10000 });

        const label = await page.locator('#sessionCodeText').textContent();
        const code = String(label || '').match(/CRG-[A-Z0-9]+/)?.[0] || '';
        expect(code).toMatch(/^CRG-[A-Z0-9]{10}$/);

        createdCodes.push(code);

        const publishResult = await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.());
        if (publishResult?.storageReady !== true) {
          throw new Error('40-player live publish did not report storageReady=true.');
        }

        hostKey = await page.evaluate(currentCode =>
          localStorage.getItem('crg-supabase-host-key-v1:' + currentCode) || '', code
        );
        expect(hostKey).toMatch(/^[0-9a-f]{64}$/);

        const response = await rest(request, 'GET',
          `/rest/v1/${TABLE}?select=payload%2Cupdated_at&session_code=eq.${encodeURIComponent(code)}`,
          { headers: { 'x-crg-session-code': code } }
        );
        if (!response.ok()) throw new Error(`HTTP ${response.status()} ${firstLine(await response.text())}`);
        const rows = await response.json();
        if (rows.length !== 1 || !rows[0]?.payload) {
          throw new Error('40-player live row was not found after publish.');
        }

        const payload = rows[0].payload;
        const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
        const capBytes = 200000;
        const percentOfCap = (payloadBytes / capBytes) * 100;
        const previousBaselineBytes = 69155;
        const baselineDeltaPercent = ((payloadBytes - previousBaselineBytes) / previousBaselineBytes) * 100;
        if (payloadBytes >= capBytes) {
          throw new Error(`Payload is ${payloadBytes} bytes, over the 200000-byte cap.`);
        }
        const baselineFlag = Math.abs(baselineDeltaPercent) > 25
          ? `FLAG baseline delta=${baselineDeltaPercent.toFixed(1)}%`
          : `baseline delta=${baselineDeltaPercent.toFixed(1)}%`;
        return `payload=${payloadBytes} bytes (${percentOfCap.toFixed(2)}% of cap); players=40; ${baselineFlag}`;
      }
    );
  });

  test.afterAll(() => {
    for (const code of createdCodes) console.log(`CREATED_SESSION_CODE ${code}`);
    console.log('CLEANUP_NOTE anon key cannot delete these rows; use the listed codes for SQL cleanup.');
  });
});
