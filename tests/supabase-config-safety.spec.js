const { test, expect } = require('@playwright/test');

const CONFIGURED_HOST = 'https://wochetemsnrysnjrgoed.supabase.co';

async function mockConfig(page, configured) {
  await page.route('**/api/live-config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(configured
      ? { configured: true, url: CONFIGURED_HOST, publishableKey: 'test-publishable-key', source: 'vercel-env' }
      : { configured: false, url: '', publishableKey: '', source: 'vercel-env' }),
  }));
}

test('live sync uses only the configured Supabase host', async ({ page }) => {
  const httpHosts = [];
  const socketHosts = [];
  await mockConfig(page, true);
  page.on('request', request => {
    const url = request.url();
    if (/^https:\/\/[^/]+\.supabase\.co\//.test(url)) httpHosts.push(new URL(url).origin);
  });
  page.on('websocket', socket => socketHosts.push(new URL(socket.url()).origin.replace(/^wss:/, 'https:')));
  await page.route('https://*.supabase.co/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ payload: { sessionCode: 'CRG-TEST', updatedAt: new Date().toISOString(), current: { game: 'Game 1', court: 1, teams: [[{ name: 'A' }], [{ name: 'B' }]], sitting: [] }, progress: { completed: 0, total: 1, percent: 0 }, schedule: [], upNext: [], matchLog: [], rankings: [] }, updated_at: new Date().toISOString() }),
  }));
  await page.goto('/?live=CRG-TEST&view=spectator');
  await expect(page.locator('.spectator-current')).toBeVisible({ timeout: 5000 });
  const allHosts = [...new Set([...httpHosts, ...socketHosts])];
  expect(allHosts.length).toBeGreaterThan(0);
  expect(allHosts.every(host => host === CONFIGURED_HOST)).toBe(true);
});

test('missing Supabase config shows Live sync unavailable without contacting Supabase', async ({ page }) => {
  const supabaseRequests = [];
  await mockConfig(page, false);
  page.on('request', request => {
    if (/^https:\/\/[^/]+\.supabase\.co\//.test(request.url())) supabaseRequests.push(request.url());
  });
  await page.route('https://*.supabase.co/**', route => route.abort());
  await page.goto('/?live=CRG-TEST&view=spectator');
  await expect(page.locator('.spectator-connect-card')).toContainText('Live sync unavailable');
  await expect(page.locator('.spectator-fallback-label')).toContainText('Read-only snapshot fallback');
  expect(supabaseRequests).toEqual([]);
});
