const { test, expect } = require('@playwright/test');

const roster = count => Array.from({ length: count }, (_, i) => 'Player ' + (i + 1)).join('\n');

test('Sunlight persists, stays out of live state, meets 7:1 contrast, and fits 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.removeItem('crg-theme');
    localStorage.removeItem('crg-live-state-v1');
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#themeBtn')).toHaveText('☀ Sunlight');
  await page.locator('#themeBtn').click();
  await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('sunlight');
  expect(await page.evaluate(() => localStorage.getItem('crg-theme'))).toBe('sunlight');

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('sunlight');
  await expect(page.locator('#themeBtn')).toHaveText('🌲 Forest');

  await page.locator('#names').fill(roster(8));
  await page.locator('#courts').fill('1');
  await page.locator('#generateBtn').click();
  await expect(page.locator('#setupStatus')).toContainText('Rotation ready', { timeout: 8000 });

  const state = await page.evaluate(() => {
    const raw = localStorage.getItem('crg-live-state-v1');
    return raw ? JSON.parse(raw) : null;
  });
  expect(state).not.toBeNull();
  expect(Object.prototype.hasOwnProperty.call(state, 'theme')).toBe(false);
  expect(JSON.stringify(state)).not.toContain('"theme"');

  await page.evaluate(() => {
    const config = window.CRG_SUPABASE_CONFIG;
    config.url = 'https://fake.supabase.test';
    config.publishableKey = 'fake-key';
    window.CRG_SUPABASE_CONFIG_READY = Promise.resolve(config);
    window.__crgCapturedSyncPayload = null;
    window.supabase = {
      createClient: () => ({
        rpc: async (_name, args) => {
          window.__crgCapturedSyncPayload = args?.p_payload || null;
          return { data: true, error: null };
        },
      }),
    };
  });

  await page.evaluate(async () => window.CRG_PUBLISH_LIVE?.(true));
  await expect.poll(() => page.evaluate(() => window.__crgCapturedSyncPayload)).not.toBeNull();
  const syncPayload = await page.evaluate(() => window.__crgCapturedSyncPayload);
  expect(JSON.stringify(syncPayload)).not.toContain('"theme"');

  const contrast = await page.evaluate(() => {
    const parseRgb = value => {
      const match = String(value || '').match(/rgba?\(([^)]+)\)/i);
      if (!match) throw new Error('Expected an rgb/rgba color, got: ' + value);
      const [r, g, b] = match[1].split(',').map(part => Number.parseFloat(part.trim()));
      return { r, g, b };
    };

    const luminance = ({ r, g, b }) => {
      const channel = value => {
        const normalized = value / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    const ratio = (foreground, background) => {
      const a = luminance(parseRgb(foreground));
      const b = luminance(parseRgb(background));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };

    const visibleBackground = node => {
      let current = node;
      while (current) {
        const background = getComputedStyle(current).backgroundColor;
        if (background && !/^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(background)) return background;
        current = current.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };

    const body = document.body;
    const hint = document.querySelector('.hint');
    const nav = document.querySelector('.nav-btn.active');
    const primary = document.querySelector('#generateBtn');
    const bodyStyle = getComputedStyle(body);
    const hintStyle = getComputedStyle(hint);
    const navStyle = getComputedStyle(nav);
    const primaryStyle = getComputedStyle(primary);

    return {
      body: ratio(bodyStyle.color, bodyStyle.backgroundColor),
      hint: ratio(hintStyle.color, visibleBackground(hint)),
      activeNav: ratio(navStyle.color, navStyle.backgroundColor),
      primary: ratio(primaryStyle.color, primaryStyle.backgroundColor),
      values: {
        body: { color: bodyStyle.color, background: bodyStyle.backgroundColor },
        hint: { color: hintStyle.color, background: visibleBackground(hint) },
        activeNav: { color: navStyle.color, background: navStyle.backgroundColor },
        primary: { color: primaryStyle.color, background: primaryStyle.backgroundColor },
      },
    };
  });

  for (const [name, ratio] of Object.entries({
    body: contrast.body,
    hint: contrast.hint,
    activeNav: contrast.activeNav,
    primary: contrast.primary,
  })) {
    expect(ratio, name + ' contrast ratio').toBeGreaterThanOrEqual(7);
  }

  await expect(page.locator('#themeBtn')).toHaveText('🌲 Forest');
  await expect(page.locator('#courtModeBtn')).toHaveText('☀ Court mode');
  expect(await page.locator('#themeBtn').innerText()).not.toBe(await page.locator('#courtModeBtn').innerText());

  const viewport = await page.evaluate(() => {
    const width = window.innerWidth;
    const controls = [...document.querySelectorAll('.topbar button')].map(node => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.id,
        left: rect.left,
        right: rect.right,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
      };
    });
    return {
      width,
      documentScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      controls,
    };
  });

  expect(viewport.documentScrollWidth).toBeLessThanOrEqual(viewport.viewportWidth + 1);
  for (const control of viewport.controls) {
    expect(control.left).toBeGreaterThanOrEqual(-0.5);
    expect(control.right).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth + 1);
  }

  await page.locator('#themeBtn').click();
  await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('crg-theme'))).toBe('forest');

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBeNull();
});
