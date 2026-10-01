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

test('Live-sync failure shows a notice and does not silently fall back to a snapshot', async ({ page }) => {
  await installClipboard(page);
  await failSupabaseClient(page);
  await generateSession(page, 5);

  await page.evaluate(() => {
    window.__crgToastHistory = [];
    window.__crgLastToast = '';
    window.__crgToastObserver = new MutationObserver(records => {
      for (const mutation of records) {
        if (mutation.type === 'childList' && (mutation.target?.id === 'crgToast' || mutation.target?.closest?.('#crgToast'))) {
          for (const node of mutation.addedNodes || []) {
            const value = node.textContent?.trim() || '';
            if (value && value !== window.__crgLastToast) {
              window.__crgToastHistory.push({ at: performance.now(), text: value });
              window.__crgLastToast = value;
            }
          }
        }
        if (mutation.type === 'attributes' && mutation.target?.id === 'crgToast' && mutation.target.classList.contains('show')) {
          const value = mutation.target.textContent?.trim() || '';
          if (value && value !== window.__crgLastToast) {
            window.__crgToastHistory.push({ at: performance.now(), text: value });
            window.__crgLastToast = value;
          }
        }
      }
    });
    window.__crgToastObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });

  const beforeButton = await page.locator('#copyLiveSpectatorBtn').textContent();
  expect(beforeButton.trim()).toBe('Copy live spectator link');

  await page.locator('#copyLiveSpectatorBtn').click();

  await expect.poll(() => page.evaluate(() => window.__crgToastHistory || []), { timeout: 5000 })
    .toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringMatching(/live sync unavailable/i) })]));

  const result = await page.evaluate(() => {
    window.__crgToastObserver?.disconnect();
    return {
      notices: window.__crgToastHistory,
      copied: window.__crgCopiedText || '',
      button: document.querySelector('#copyLiveSpectatorBtn')?.textContent?.trim() || '',
    };
  });

  expect(result.notices.some(n => /live sync unavailable/i.test(n.text))).toBe(true);
  expect(result.copied).toBe('');
  expect(result.button).toBe('Live sync unavailable · retrying');

  await page.locator('#addMidSessionPlayerBtn').click();
  await expect(page.locator('#midPlayerConfirm')).toBeVisible();
  await page.locator('#midPlayerCancel').click();
  await expect(page.locator('#completeBtn')).toBeEnabled();
  await expect(page.locator('#upNextList .next-item[data-upcoming-index]')).toHaveCount(4);
});

test('Mobile navigation stays fixed and keeps all six tabs visible', async ({ page }) => {
  for (const width of [360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const state = await page.locator('.bottom-nav').evaluate(node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        position: style.position,
        left: rect.left,
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.bottom,
        visibleTabs: [...node.querySelectorAll('.nav-btn')].filter(btn => !btn.hidden && getComputedStyle(btn).display !== 'none').length,
        bodyPaddingBottom: parseFloat(getComputedStyle(document.body).paddingBottom) || 0,
      };
    });

    expect(state.position).toBe('fixed');
    expect(state.left).toBeGreaterThanOrEqual(8);
    expect(state.right).toBeGreaterThanOrEqual(8);
    expect(state.bottom).toBeGreaterThanOrEqual(7);
    expect(state.visibleTabs).toBe(6);
    expect(state.bodyPaddingBottom).toBeGreaterThan(50);
  }
});

test('Touch Up Next drag starts only from the handle and persists the reordered schedule', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(5));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  await expect(page.locator('.game-match')).toHaveCount(5, { timeout: 5000 });

  const before = await page.evaluate(() => {
    const game2 = document.querySelector('#scheduleList .game-row:nth-child(2) .game-match');
    return {
      game2Match: game2?.textContent.replace(/⭐/g, '').replace(/\s+/g, ' ').trim() || '',
      game2Teams: [...(document.querySelector('#scheduleList .game-row:nth-child(2)')?.querySelectorAll('.game-team-label') || [])].map(node => node.textContent || ''),
    };
  });

  const blocked = await page.evaluate(() => {
    const card = document.querySelector('#upNextList .next-item[data-upcoming-index="1"]');
    if (!card) throw new Error('missing Game 2 card');
    const rect = card.getBoundingClientRect();
    const event = init => new PointerEvent(init.type, {
      bubbles: true,
      pointerId: 41,
      pointerType: 'touch',
      clientX: rect.left + 100,
      clientY: rect.top + rect.height / 2,
      ...init,
    });
    card.dispatchEvent(event({ type: 'pointerdown' }));
    document.dispatchEvent(event({ type: 'pointermove', clientX: rect.left + 100, clientY: rect.top + rect.height + 100 }));
    return document.querySelectorAll('.upnext-dragging-card').length;
  });
  expect(blocked).toBe(0);

  await page.evaluate(() => {
    document.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 41,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    }));
  });

  const drag = await page.evaluate(() => {
    const source = document.querySelector('#upNextList .next-item[data-upcoming-index="1"]');
    const target = document.querySelector('#upNextList .next-item[data-upcoming-index="3"]');
    if (!source || !target) throw new Error('missing touch-drag targets');
    const sourceHandle = source.querySelector('.drag-handle');
    const sr = source.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    if (!sourceHandle) throw new Error('missing drag handle');
    sourceHandle.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 42,
      pointerType: 'touch',
      clientX: sr.right - 12,
      clientY: sr.top + sr.height / 2,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 42,
      pointerType: 'touch',
      clientX: tr.left + tr.width / 2,
      clientY: tr.bottom - 4,
    }));
    const dragging = document.querySelectorAll('.upnext-dragging-card').length;
    const placeholder = document.querySelectorAll('.upnext-drag-placeholder').length;
    document.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      pointerId: 42,
      pointerType: 'touch',
      clientX: tr.left + tr.width / 2,
      clientY: tr.bottom - 4,
    }));
    return { dragging, placeholder };
  });

  expect(drag.dragging).toBe(1);
  expect(drag.placeholder).toBe(1);
  await expect(page.locator('.upnext-dragging-card')).toHaveCount(0);
  await expect(page.locator('.upnext-drag-placeholder')).toHaveCount(0);
  await expect(page.locator('#upNextReorderStatus')).toContainText('Moved Game 2 to Game 4.');

  const after = await page.evaluate(() => {
    const row = document.querySelector('#scheduleList .game-row:nth-child(4)');
    const saved = JSON.parse(localStorage.getItem('crg-live-state-v1') || 'null');
    return {
      match: row?.querySelector('.game-match')?.textContent.replace(/⭐/g, '').replace(/\s+/g, ' ').trim() || '',
      labels: [...(row?.querySelectorAll('.game-team-label') || [])].map(node => node.textContent || ''),
      savedMatch: saved?.games?.[3]?.teams || null,
    };
  });
  expect(after.match).toBe(before.game2Match);
  expect(after.labels).toEqual(before.game2Teams);
  expect(after.savedMatch).not.toBeNull();
});
