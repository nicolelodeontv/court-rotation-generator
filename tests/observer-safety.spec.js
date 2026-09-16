const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const observerFiles = [
  'live-display.js',
  'live-skills.js',
  'live-sync.js',
  'player-ui.js',
  'readability.js',
  'session-tools-fix.js',
  'spectator-fix.js',
  'ui-polish.js',
];

test('each MutationObserver has an explicit safety annotation', () => {
  for (const file of observerFiles) {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    const matches = [...source.matchAll(/new MutationObserver\(/g)];
    expect(matches.length, `${file}: expected at least one MutationObserver`).toBeGreaterThan(0);
    for (const match of matches) {
      const before = source.slice(Math.max(0, match.index - 500), match.index);
      expect(before, `${file}: observer is missing a nearby safety comment`).toMatch(/Safe observer:/);
    }
  }
});
