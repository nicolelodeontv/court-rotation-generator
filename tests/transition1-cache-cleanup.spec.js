const { test, expect } = require('@playwright/test');

test('Transition 1 removes cache-cleanup.js while sw.js retains retirement logic', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('script[src*="cache-cleanup.js"]')).toHaveCount(0);

  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toContain('self.registration.unregister()');
  expect(sw).toContain('caches.delete');
});
