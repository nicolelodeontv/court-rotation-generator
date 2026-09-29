// CI rerun marker for PR23-only diagnostic.
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

test('PR #23 failure notice and auto-copied snapshot fallback', async ({ page }) => {
  await installClipboard(page);
  await failSupabaseClient(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(5));
  await page.locator('#playerConfirm').click();
  await expect(page.locator('#playerList .player-row')).toHaveCount(5, { timeout: 2500 });
  await page.locator('#generateBtn').click();
  await expect(page.locator('#setupStatus')).toContainText('Rotation ready', { timeout: 8000 });

  await page.evaluate(() => {
    let toast = document.querySelector('#crgToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'crgToast';
      document.body.appendChild(toast);
    }
    window.__crgNoticeHistory = [];
    window.__crgLastToast = '';
    window.__crgNoticeObserver = new MutationObserver(records => {
      for (const mutation of records) {
        if (mutation.target?.id === 'crgToast' && mutation.type === 'childList') {
          for (const node of mutation.addedNodes || []) {
            const value = node.textContent.trim();
            if (value && value !== window.__crgLastToast) {
              window.__crgNoticeHistory.push({ at: performance.now(), text: value });
              window.__crgLastToast = value;
            }
          }
        }
      }
    });
    window.__crgNoticeObserver.observe(toast, { childList: true });
  });

  const before = await page.locator('#copyLiveSpectatorBtn').textContent();
  expect(before.trim()).toBe('Copy live spectator link');

  await page.locator('#copyLiveSpectatorBtn').click();
  await expect.poll(() => page.evaluate(() => window.__crgCopiedText || ''), { timeout: 5000 })
    .toMatch(/(?:\?|&)s=/);
  await page.waitForTimeout(900);

  const result = await page.evaluate(() => {
    window.__crgNoticeObserver?.disconnect();
    return {
      notices: window.__crgNoticeHistory,
      copied: window.__crgCopiedText || '',
      button: document.querySelector('#copyLiveSpectatorBtn')?.textContent?.trim() || '',
      finalToast: document.querySelector('#crgToast')?.textContent?.trim() || '',
    };
  });

  console.log('PR23_NOTICE_HISTORY', JSON.stringify(result.notices));
  console.log('PR23_COPIED_URL', result.copied);
  console.log('PR23_AFTER_BUTTON', result.button);
  console.log('PR23_FINAL_TOAST', result.finalToast);

  expect(result.notices.some(n => n.text === 'Live sync unavailable · use the snapshot link instead')).toBe(true);
  expect(result.notices.some(n => n.text === 'Read-only snapshot link copied')).toBe(true);
  expect(result.copied).toMatch(/(?:\?|&)s=/);
  expect(result.copied).toContain('view=spectator');
  expect(result.copied).not.toContain('live=');
  expect(result.button).toBe('Copy read-only snapshot link');
  expect(result.finalToast).toBe('Read-only snapshot link copied');
});
