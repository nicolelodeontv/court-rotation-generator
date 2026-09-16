const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const projectRoot = process.cwd();
const files = fs.readdirSync(projectRoot).filter(name => name.endsWith('.js') && !name.startsWith('playwright.'));

test('every MutationObserver has an explicit safety annotation', () => {
  for (const file of files) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    const matches = [...source.matchAll(/new MutationObserver\(/g)];
    for (const match of matches) {
      const before = source.slice(Math.max(0, match.index - 700), match.index);
      expect(before, `${file}: observer is missing a nearby Safe observer comment`).toMatch(/Safe observer:/);
    }
  }
});
