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

async function inspect(page) {
  return page.evaluate(() => ({
    button: document.querySelector('#copyLiveSpectatorBtn')?.textContent?.trim() || '',
    copied: window.__crgCopiedText || '',
    toast: document.querySelector('#crgToast')?.textContent?.trim() || '',
    toastVisible: !!document.querySelector('#crgToast.show'),
    setupStatus: document.querySelector('#setupStatus')?.textContent?.trim() || '',
    nextGameStatus: document.querySelector('#nextGameStatus')?.textContent?.trim() || '',
  }));
}

test('Capture live-sync failure notices and snapshot fallback', async ({ page }) => {
  await installClipboard(page);
  await failSupabaseClient(page);
  await generateSession(page, 5);

  console.log('BEFORE', JSON.stringify(await inspect(page)));

  await page.evaluate(() => {
    window.__crgNoticeHistory = [];
    window.__crgLastNotice = '';
    window.__crgNoticeSampler = setInterval(() => {
      const candidates = [
        ['#crgToast', document.querySelector('#crgToast')],
        ['#setupStatus', document.querySelector('#setupStatus')],
        ['#nextGameStatus', document.querySelector('#nextGameStatus')],
        ['[role="status"]', document.querySelector('[role="status"]')],
      ];
      const visible = candidates
        .filter(([, node]) => node && node.offsetParent !== null)
        .map(([selector, node]) => ({ selector, text: node.textContent.trim() }))
        .filter(x => x.text);
      const snapshot = visible.map(x => x.selector + '|' + x.text).join('||');
      if (snapshot && snapshot !== window.__crgLastNotice) {
        const toast = visible.find(x => x.selector === '#crgToast');
        if (toast) {
          window.__crgNoticeHistory.push({
            at: performance.now(),
            selector: toast.selector,
            text: toast.text,
          });
        }
        window.__crgLastNotice = snapshot;
      }
    }, 5);
  });

  await page.locator('#copyLiveSpectatorBtn').click();
  await expect.poll(() => page.evaluate(() => window.__crgCopiedText || ''), { timeout: 5000 })
    .toMatch(/(?:\?|&)s=/);
  await page.waitForTimeout(900);

  const result = await page.evaluate(() => {
    clearInterval(window.__crgNoticeSampler);
    return {
      notices: window.__crgNoticeHistory,
      after: {
        button: document.querySelector('#copyLiveSpectatorBtn')?.textContent?.trim() || '',
        copied: window.__crgCopiedText || '',
        toast: document.querySelector('#crgToast')?.textContent?.trim() || '',
        toastVisible: !!document.querySelector('#crgToast.show'),
      },
    };
  });

  console.log('NOTICE_SEQUENCE', JSON.stringify(result.notices));
  console.log('AFTER', JSON.stringify(result.after));
  console.log('COPIED_URL_HAS_SNAPSHOT', /(?:\?|&)s=/.test(result.after.copied) && /[?&]view=spectator/.test(result.after.copied));
  console.log('COPIED_URL_HAS_LIVE', /(?:\?|&)live=/.test(result.after.copied));
});
