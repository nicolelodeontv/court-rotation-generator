const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const projectRoot = process.cwd();
const observerFiles = fs.readdirSync(projectRoot)
  .filter(name => name.endsWith('.js') && !name.startsWith('playwright.'))
  .filter(name => name !== 'live-display.js');

test('observer architecture has explicit safety annotations', () => {
  const liveDisplay = fs.readFileSync(path.join(projectRoot, 'live-display.js'), 'utf8');
  expect(liveDisplay, 'live-display.js should use explicit render hooks instead of MutationObserver').not.toMatch(/new MutationObserver\(/);
  expect(liveDisplay, 'live-display.js should expose its explicit render hook').toMatch(/CRG_RENDER_LIVE_DISPLAY/);
  expect(liveDisplay, 'live-display.js should document the observer-free render-hook safety').toMatch(/Safe render hook:/);

  const uiPolish = fs.readFileSync(path.join(projectRoot, 'ui-polish.js'), 'utf8');
  expect(uiPolish, 'ui-polish.js should use a stable polished flag').toMatch(/dataset\.polished==='true'/);
  expect(uiPolish, 'ui-polish.js should scope its observer away from document.body').not.toMatch(/obs\.observe\(document\.body/);

  const sessionTools = fs.readFileSync(path.join(projectRoot, 'session-tools-fix.js'), 'utf8');
  expect(sessionTools, 'session-tools-fix.js should document observer safety').toMatch(/Safe observer:/);
  expect(sessionTools, 'session-tools-fix.js cleanup should guard its hint text write').toMatch(/hint\.textContent!==text/);
  expect(sessionTools, 'session-tools-fix.js observer should not watch arbitrary attributes').not.toMatch(/attributes:true/);
  expect('data-runtime-monitored', 'dataset.runtimeMonitored maps to the kebab-case HTML attribute name').toBe('data-runtime-monitored');
  expect(sessionTools, 'session-tools-fix.js monitorButtons should use the runtimeMonitored dataset guard').toMatch(/dataset\.runtimeMonitored/);

  for (const file of observerFiles) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    const matches = [...source.matchAll(/new MutationObserver\(/g)];
    for (const match of matches) {
      const before = source.slice(Math.max(0, match.index - 700), match.index);
      expect(before, `${file}: observer is missing a nearby Safe observer comment`).toMatch(/Safe observer:/);
    }
  }
});
