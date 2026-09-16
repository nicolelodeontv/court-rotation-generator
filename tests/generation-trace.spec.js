const { test, expect } = require('@playwright/test');

test('trace generation boundary and render completion', async ({ page }) => {
  const messages = [];
  const failedScripts = [];
  const parsedScripts = new Map();
  page.on('console', msg => messages.push(msg.text()));
  page.on('pageerror', error => messages.push(`PAGEERROR:${error.message}`));
  page.on('dialog', async dialog => {
    const entry = `DIALOG: type=${dialog.type()} message=${JSON.stringify(dialog.message())}`;
    messages.push(entry);
    console.log(`[CRG-TRACE] ${entry}`);
    await dialog.dismiss();
  });
  page.on('response', response => {
    if (!response.ok() && /\.js(?:\?|$)/.test(response.url())) {
      const entry = `SCRIPT LOAD FAILED: ${response.status()} ${response.url()}`;
      failedScripts.push(entry);
      console.log(`[CRG-TRACE] ${entry}`);
    }
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Debugger.enable');
  cdp.on('Debugger.scriptParsed', event => {
    parsedScripts.set(event.scriptId, {
      scriptId: event.scriptId,
      url: event.url || '',
      startLine: event.startLine,
      endLine: event.endLine,
      executionContextId: event.executionContextId,
    });
  });

  await page.evaluate(() => 0);
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
  });

  const pausedFrames = [];
  let paused = false;
  cdp.on('Debugger.paused', async event => {
    paused = true;
    for (const frame of event.callFrames || []) {
      const scriptId = frame.location?.scriptId || '';
      let source = null;
      try {
        source = (await cdp.send('Debugger.getScriptSource', { scriptId })).scriptSource;
      } catch (error) {
        source = `GET_SCRIPT_SOURCE_FAILED:${error.message}`;
      }
      pausedFrames.push({
        functionName: frame.functionName || '(anonymous)',
        url: frame.url || '',
        scriptId,
        lineNumber: frame.location?.lineNumber ?? -1,
        columnNumber: frame.location?.columnNumber ?? -1,
        source,
      });
    }
    console.log(`[CRG-TRACE] CDP PAUSED reason=${event.reason} frames=${JSON.stringify(pausedFrames)}`);
  });

  await page.locator('#generateBtn').click();
  await new Promise(resolve => setTimeout(resolve, 500));
  if (!paused) {
    console.log('[CRG-TRACE] CDP pause requested after 500ms');
    await cdp.send('Debugger.pause');
  }
  await page.waitForTimeout(3500);

  console.log(`[CRG-TRACE] SCRIPT INVENTORY count=${parsedScripts.size}`);
  for (const script of parsedScripts.values()) {
    console.log(`[CRG-TRACE] SCRIPT PARSED scriptId=${script.scriptId} url=${JSON.stringify(script.url)} lines=${script.startLine}-${script.endLine} context=${script.executionContextId}`);
  }
  console.log(`[CRG-TRACE] PAUSED FRAMES=${JSON.stringify(pausedFrames)}`);

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
