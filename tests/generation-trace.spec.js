const { test, expect } = require('@playwright/test');

test('trace generation boundary and render completion', async ({ page }) => {
  const messages = [];
  page.on('console', msg => messages.push(msg.text()));
  page.on('pageerror', error => messages.push(`PAGEERROR:${error.message}`));

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(Array.from({ length: 24 }, (_, i) => `Player ${i + 1}`).join('\n'));
  await page.locator('#playerConfirm').click();
  await expect(page.locator('#playerList .player-row')).toHaveCount(24);

  await page.evaluate(() => {
    const original = window.RotationScheduler.generate;
    window.RotationScheduler.generate = (...args) => {
      console.log('TRACE scheduler:start');
      const started = performance.now();
      const result = original(...args);
      console.log(`TRACE scheduler:end:${Math.round(performance.now() - started)}ms games=${result?.games?.length || 0}`);
      return result;
    };
    for (const name of ['render', 'renderCurrent', 'renderStats', 'renderSchedule', 'renderPlayers', 'renderRankings', 'renderSummary']) {
      // App functions are closure-local; this marker documents that the boundary test intentionally
      // relies on scheduler start/end plus the DOM status transition to isolate the synchronous phase.
      void name;
    }
  });

  await page.locator('#generateBtn').click();
  await page.waitForTimeout(3500);

  const state = await page.evaluate(() => ({
    status: document.querySelector('#setupStatus')?.textContent || '',
    games: document.querySelectorAll('#scheduleList .game-row').length,
    currentTeams: document.querySelector('#currentTeams')?.textContent || '',
  }));

  console.log(`TRACE final status=${state.status} scheduleRows=${state.games} currentTeams=${state.currentTeams}`);
  console.log(`TRACE messages=${JSON.stringify(messages)}`);
  expect(state.status, `generation trace: ${JSON.stringify({ state, messages })}`).toContain('Rotation ready');
});
