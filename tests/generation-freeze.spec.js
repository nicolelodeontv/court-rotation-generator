const { test, expect } = require('@playwright/test');

const roster = Array.from({ length: 24 }, (_, i) => `Player ${i + 1}`).join('\n');

test('page remains interactive after load and rotation generation', async ({ page }) => {
  const trace = [];
  const addTrace = message => {
    trace.push(message);
    console.log(`[CRG-TRACE] ${message}`);
  };

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

    const button = document.querySelector('#generateBtn');
    button?.addEventListener('click', () => push('A: Generate rotation click handler reached'), true);

    if (window.RotationScheduler?.generate) {
      const originalGenerate = window.RotationScheduler.generate;
      window.RotationScheduler.generate = function tracedSchedulerGenerate(...args) {
        push('B: Scheduler generate() entered');
        try {
          const result = originalGenerate.apply(this, args);
          push(`B: Scheduler generate() returned games=${result?.games?.length ?? 'none'} score=${result?.score ?? 'none'}`);
          return result;
        } catch (error) {
          push(`B: Scheduler generate() threw ${error?.message || error}`);
          throw error;
        }
      };
    } else {
      push('B: Scheduler generate() wrapper could not attach — RotationScheduler.generate missing');
    }

    if (window.CRG_RENDER_LIVE_DISPLAY) {
      const originalRender = window.CRG_RENDER_LIVE_DISPLAY;
      window.CRG_RENDER_LIVE_DISPLAY = function tracedLiveDisplayRender(...args) {
        push('C: Explicit CRG_RENDER_LIVE_DISPLAY hook called');
        return originalRender.apply(this, args);
      };
    } else {
      push('C: Explicit CRG_RENDER_LIVE_DISPLAY hook missing before generation');
    }

    const status = document.querySelector('#setupStatus');
    if (status) {
      const observer = new MutationObserver(() => {
        push(`D: #setupStatus updated to "${status.textContent}"`);
      });
      observer.observe(status, { childList: true, characterData: true, subtree: true });
      push(`D: Status observer attached; current text="${status.textContent}"`);
    } else {
      push('D: #setupStatus element missing');
    }
  });

  addTrace('TEST: About to click #generateBtn');
  await page.locator('#generateBtn').click({ timeout: 1000 });

  try {
    await expect(page.locator('#setupStatus')).toContainText('Rotation ready', { timeout: 5000 });
  } catch (error) {
    const browserTrace = await page.evaluate(() => window.__crgTrace || []);
    console.log('[CRG-TRACE] ===== FINAL TRACE =====');
    for (const message of browserTrace) console.log(`[CRG-TRACE] ${message}`);
    throw error;
  }

  const browserTrace = await page.evaluate(() => window.__crgTrace || []);
  for (const message of browserTrace) {
    if (!trace.includes(message)) console.log(`[CRG-TRACE] ${message}`);
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
