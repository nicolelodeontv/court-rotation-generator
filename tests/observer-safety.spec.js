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

  for (const file of observerFiles) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    const matches = [...source.matchAll(/new MutationObserver\(/g)];
    for (const match of matches) {
      const before = source.slice(Math.max(0, match.index - 700), match.index);
      expect(before, `${file}: observer is missing a nearby Safe observer comment`).toMatch(/Safe observer:/);
    }
  }
});
