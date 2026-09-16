const { test, expect } = require('@playwright/test');

const roster = Array.from({ length: 24 }, (_, i) => `Player ${i + 1}`).join('\n');

test('page remains interactive after load and rotation generation', async ({ page }) => {
  const trace = [];
  page.on('console', message => {
    const text = message.text();
    if (!text.startsWith('[CRG-TRACE]')) return;
    trace.push(text);
    console.log(text);
  });
  page.on('pageerror', error => console.log(`[CRG-TRACE] PAGEERROR: ${error.message}`));

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    window.__crgSmokeClicks = 0;
    document.querySelector('#themeBtn')?.addEventListener('click', () => {
      window.__crgSmokeClicks += 1;
    });
  });

  await page.locator('#themeBtn').click({ timeout: 1000 });
  await expect.poll(() => page.evaluate(() => window.__crgSmokeClicks)).toBe(1);

  await page.locator('#playerPasteBtn').click({ timeout: 1000 });
  await page.locator('#pastePlayerNames').fill(roster, { timeout: 1000 });
  await page.locator('#playerConfirm').click({ timeout: 1000 });

  await expect(page.locator('#playerList .player-row')).toHaveCount(24, { timeout: 2000 });

  await page.evaluate(() => {
    window.__crgTrace = [];
    const push = message => {
      window.__crgTrace.push(message);
      console.info(`[CRG-TRACE] ${message}`);
    };

    document.addEventListener('click', event => {
      if (event.target?.closest?.('#generateBtn')) push('A0: Generate button click reached document capture');
    }, true);

    const button = document.querySelector('#generateBtn');
    button?.addEventListener('click', () => push('A1: Generate button click reached target capture'), true);
    button?.addEventListener('click', () => push('A2: Generate button target handler phase reached'), false);

    if (window.RotationScheduler?.generate) {
      const originalGenerate = window.RotationScheduler.generate;
      window.RotationScheduler.generate = function tracedSchedulerGenerate(...args) {
        push('B1: Scheduler generate() entered');
        try {
          const result = originalGenerate.apply(this, args);
          push(`B2: Scheduler generate() returned games=${result?.games?.length ?? 'none'} score=${result?.score ?? 'none'}`);
          return result;
        } catch (error) {
          push(`B2: Scheduler generate() threw ${error?.message || error}`);
          throw error;
        }
      };
    } else {
      push('B0: Scheduler generate() wrapper could not attach — RotationScheduler.generate missing');
    }

    if (window.CRG_RENDER_LIVE_DISPLAY) {
      const originalRender = window.CRG_RENDER_LIVE_DISPLAY;
      window.CRG_RENDER_LIVE_DISPLAY = function tracedLiveDisplayRender(...args) {
        push('C: Explicit CRG_RENDER_LIVE_DISPLAY hook called');
        return originalRender.apply(this, args);
      };
    } else {
      push('C0: Explicit CRG_RENDER_LIVE_DISPLAY hook missing before generation');
    }

    const status = document.querySelector('#setupStatus');
    if (status) {
      const observer = new MutationObserver(() => {
        push(`D: #setupStatus updated to "${status.textContent}"`);
      });
      observer.observe(status, { childList: true, characterData: true, subtree: true });
      push(`D0: Status observer attached; current text="${status.textContent}"`);
    } else {
      push('D0: #setupStatus element missing');
    }
  });

  console.log('[CRG-TRACE] TEST: About to click #generateBtn');
  await page.locator('#generateBtn').click({ timeout: 1000 });

  try {
    await expect(page.locator('#setupStatus')).toContainText('Rotation ready', { timeout: 5000 });
  } catch (error) {
    console.log('[CRG-TRACE] ===== FINAL STREAMED TRACE =====');
    for (const message of trace) console.log(message);
    throw error;
  }

  await page.evaluate(() => {
    window.__crgPostGenerateClicks = 0;
    document.querySelector('[data-view="liveView"]')?.addEventListener('click', () => {
      window.__crgPostGenerateClicks += 1;
    });
  });

  await page.waitForTimeout(2000);
  await page.locator('[data-view="liveView"]').click({ timeout: 1000 });
  await expect.poll(() => page.evaluate(() => window.__crgPostGenerateClicks)).toBe(1);
});
