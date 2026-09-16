const { test, expect } = require('@playwright/test');

test('trace generation boundary and render completion', async ({ page }) => {
  const messages = [];
  const failedScripts = [];
  page.on('console', msg => messages.push(msg.text()));
  page.on('pageerror', error => messages.push(`PAGEERROR:${error.message}`));
  page.on('response', response => {
    if (!response.ok() && /\.js(?:\?|$)/.test(response.url())) {
      const entry = `SCRIPT LOAD FAILED: ${response.status()} ${response.url()}`;
      failedScripts.push(entry);
      console.log(`[CRG-TRACE] ${entry}`);
    }
  });

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
      void name;
    }
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Debugger.enable');
  const pausedFrames = [];
  let paused = false;
  cdp.on('Debugger.paused', event => {
    paused = true;
    for (const frame of event.callFrames || []) {
      pausedFrames.push({
        functionName: frame.functionName || '(anonymous)',
        url: frame.url || '',
        lineNumber: frame.location?.lineNumber ?? -1,
        columnNumber: frame.location?.columnNumber ?? -1,
      });
    }
    console.log(`[CRG-TRACE] CDP PAUSED reason=${event.reason} stack=${JSON.stringify(pausedFrames)}`);
  });

  await page.locator('#generateBtn').click();
  await new Promise(resolve => setTimeout(resolve, 500));
  if (!paused) {
    console.log('[CRG-TRACE] CDP pause requested after 500ms');
    await cdp.send('Debugger.pause');
  }
  await page.waitForTimeout(3500);

  console.log('[CRG-TRACE] trivial evaluate:before');
  const trivial = await page.evaluate(() => 1 + 1);
  console.log(`[CRG-TRACE] trivial evaluate:after=${trivial}`);

  const diagnostics = await page.evaluate(async () => ({
    status: document.querySelector('#setupStatus')?.textContent || '',
    games: document.querySelectorAll('#scheduleList .game-row').length,
    currentTeams: document.querySelector('#currentTeams')?.textContent || '',
    serviceWorkers: navigator.serviceWorker ? navigator.serviceWorker.controller ? 'controlled' : 'uncontrolled' : 'unsupported',
    registrations: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).map(r => r.scope) : [],
  }));

  console.log(`TRACE diagnostics=${JSON.stringify(diagnostics)}`);
  console.log(`TRACE failedScripts=${JSON.stringify(failedScripts)}`);
  console.log(`TRACE messages=${JSON.stringify(messages)}`);
  expect(failedScripts, 'generation trace: no failed JavaScript responses expected').toEqual([]);
  expect(trivial).toBe(2);
  expect(diagnostics.status).toContain('Rotation ready');
});
