const { test, expect } = require('@playwright/test');

const roster = count => Array.from({ length: count }, (_, i) => 'Player ' + (i + 1)).join('\n');

async function installClipboard(page) {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async value => { window.__crgCopiedText = String(value); } },
      });
    } catch {}
  });
}

async function failSupabaseClient(page) {
  await page.addInitScript(() => {
    window.supabase = {
      createClient() {
        throw new Error('simulated Supabase initialization failure');
      },
    };
  });
}

async function generateSession(page, count = 5) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(count));
  await page.locator('#playerConfirm').click();
  await expect(page.locator('#playerList .player-row')).toHaveCount(count, { timeout: 2500 });
  await page.locator('#generateBtn').click();
  await expect(page.locator('#setupStatus')).toContainText('Rotation ready', { timeout: 8000 });
}

test('Live-sync failure has a visible notice and an obtainable snapshot fallback', async ({ page }) => {
  await installClipboard(page);
  await failSupabaseClient(page);
  await generateSession(page, 5);

  await page.evaluate(() => {
    window.__crgNoticeHistory = [];
    window.__crgLastToast = '';
    window.__crgNoticeSampler = setInterval(() => {
      const node = document.querySelector('#crgToast');
      const text = node?.textContent?.trim() || '';
      const visible = !!node?.classList.contains('show');
      if (visible && text && text !== window.__crgLastToast) {
        window.__crgNoticeHistory.push({ at: performance.now(), text });
        window.__crgLastToast = text;
      }
    }, 5);
  });

  const before = await page.locator('#copyLiveSpectatorBtn').textContent();
  await page.locator('#copyLiveSpectatorBtn').click();

  await expect.poll(() => page.evaluate(() => window.__crgCopiedText || ''), { timeout: 5000 })
    .toMatch(/(?:\?|&)s=/);
  await page.waitForTimeout(900);

  const result = await page.evaluate(() => {
    clearInterval(window.__crgNoticeSampler);
    return {
      notices: window.__crgNoticeHistory,
      copied: window.__crgCopiedText || '',
      button: document.querySelector('#copyLiveSpectatorBtn')?.textContent?.trim() || '',
      finalToast: document.querySelector('#crgToast')?.textContent?.trim() || '',
    };
  });

  console.log('SHARED_BEFORE_BUTTON', before.trim());
  console.log('SHARED_NOTICE_HISTORY', JSON.stringify(result.notices));
  console.log('SHARED_COPIED_URL', result.copied);
  console.log('SHARED_AFTER_BUTTON', result.button);
  console.log('SHARED_FINAL_TOAST', result.finalToast);

  expect(result.notices.some(n => /live (sync|storage) unavailable/i.test(n.text))).toBe(true);
  expect(result.copied).toMatch(/(?:\?|&)s=/);
  expect(result.copied).toContain('view=spectator');
  expect(result.copied).not.toContain('live=');
  expect(result.button).toBe('Copy read-only snapshot link');
});
