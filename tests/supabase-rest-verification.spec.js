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

  const sessionCode = await page.locator('#sessionCodeText').textContent();
  const code = String(sessionCode || '').match(/CRG-[A-Z0-9]+/)?.[0] || '';
  expect(code).toMatch(/^CRG-[A-HJ-NP-Z2-9]{10}$/);

  const hostKey = await page.evaluate(currentCode =>
    localStorage.getItem('crg-supabase-host-key-v1:' + currentCode) || '',
  code);
  expect(hostKey).toMatch(/^[0-9a-f]{64}$/);

  const publishResult = await page.evaluate(async () => {
    const result = await window.CRG_PUBLISH_LIVE?.();
    return result || null;
  });
  expect(publishResult?.storageReady).toBe(true);

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

  await check('correct-code read returns payload without host_key', async () => {
    const response = await rest(request, 'GET', basePath(code), {
      headers: { 'x-crg-session-code': code },
    });
    if (!response.ok()) throw new Error(`HTTP ${response.status()} ${await response.text()}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.payload) {
      throw new Error('Expected exactly one payload row.');
    }
    if (Object.prototype.hasOwnProperty.call(rows[0], 'host_key')) {
      throw new Error('host_key was returned.');
    }
  });

  await check('wrong-code header returns zero rows', async () => {
    const response = await rest(request, 'GET', basePath(code), {
      headers: { 'x-crg-session-code': 'CRG-' + 'A'.repeat(10) },
    });
    if (!response.ok()) throw new Error(`HTTP ${response.status()} ${await response.text()}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 0) throw new Error(`Expected 0 rows, got ${rows.length}.`);
  });

  await check('missing code header returns zero rows', async () => {
    const response = await rest(request, 'GET', basePath(code));
    if (!response.ok()) throw new Error(`HTTP ${response.status()} ${await response.text()}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 0) throw new Error(`Expected 0 rows, got ${rows.length}.`);
  });

  await check('select=host_key is denied', async () => {
    const response = await rest(
      request,
      'GET',
      `/rest/v1/${TABLE}?select=host_key&session_code=eq.${encodeURIComponent(code)}`,
      { headers: { 'x-crg-session-code': code } },
    );
    if (response.ok()) throw new Error('host_key SELECT unexpectedly succeeded.');
  });

  await check('select=* is denied or excludes host_key', async () => {
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

  await check('oversize publish is rejected', async () => {
    const oversized = { blob: 'X'.repeat(200001) };
    const response = await rest(request, 'POST', '/rest/v1/rpc/publish_session', {
      headers: { 'x-crg-session-code': code, 'x-crg-host-key': hostKey, 'Content-Type': 'application/json' },
      data: { p_code: code, p_host_key: hostKey, p_payload: oversized },
    });
    if (response.ok()) throw new Error('Oversize payload unexpectedly succeeded.');
  });

  await check('malformed session code is rejected', async () => {
    const badCode = 'CRG-' + 'A'.repeat(9) + '!';
    const response = await rest(request, 'POST', '/rest/v1/rpc/publish_session', {
      headers: { 'x-crg-session-code': badCode, 'x-crg-host-key': hostKey, 'Content-Type': 'application/json' },
      data: { p_code: badCode, p_host_key: hostKey, p_payload: { test: true } },
    });
    if (response.ok()) throw new Error('Malformed session code unexpectedly succeeded.');
  });

  await check('wrong host key cannot update the live session', async () => {
    const wrongHostKey = 'f'.repeat(64);
    const response = await rest(request, 'POST', '/rest/v1/rpc/publish_session', {
      headers: { 'x-crg-session-code': code, 'x-crg-host-key': wrongHostKey, 'Content-Type': 'application/json' },
      data: { p_code: code, p_host_key: wrongHostKey, p_payload: { tampered: true } },
    });
    if (response.ok()) throw new Error('Wrong host key unexpectedly succeeded.');
  });

  await check('delete is rejected for publishable-key clients', async () => {
    const response = await rest(request, 'DELETE', `/rest/v1/${TABLE}?session_code=eq.${encodeURIComponent(code)}`, {
      headers: { 'x-crg-session-code': code },
    });
    if (response.ok()) throw new Error('DELETE unexpectedly succeeded.');
  });

  await check('live-sync publish path wrote a real row', async () => {
    const response = await rest(request, 'GET', basePath(code), {
      headers: { 'x-crg-session-code': code },
    });
    if (!response.ok()) throw new Error(`HTTP ${response.status()} ${await response.text()}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.payload?.sessionCode) {
      throw new Error('Live-sync row was not found after publish.');
    }
  });

  await check('browser-origin CORS preflight allows custom headers', async () => {
    const browserResult = await page.evaluate(async ({ url, key, currentCode, currentHostKey }) => {
      try {
        const response = await fetch(
          url + '/rest/v1/court_rotation_sessions?select=payload&session_code=eq.' + encodeURIComponent(currentCode),
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
    }, { url: SUPABASE_URL, key: PUBLISHABLE_KEY, currentCode: code, currentHostKey: hostKey });

    if (!browserResult.ok) {
      throw new Error(`Browser fetch failed HTTP ${browserResult.status}: ${browserResult.body}`);
    }

    const preflight = corsPreflights[corsPreflights.length - 1];
    if (!preflight) throw new Error('No REST preflight response was observed.');
    const allowHeaders = String(preflight.headers['access-control-allow-headers'] || '').toLowerCase();
    if (!allowHeaders.includes('x-crg-session-code')) throw new Error('CORS response omitted x-crg-session-code.');
    if (!allowHeaders.includes('x-crg-host-key')) throw new Error('CORS response omitted x-crg-host-key.');
    if (!String(preflight.headers['access-control-allow-origin'] || '')) {
      throw new Error('CORS response omitted access-control-allow-origin.');
    }
    return `OPTIONS HTTP ${preflight.status}; allow-headers=${preflight.headers['access-control-allow-headers'] || '(none)'}`;
  });

  for (const line of resultLines) console.log(line);
  expect(failures, `Supabase verification failed: ${failures.join(', ')}`).toEqual([]);
});
