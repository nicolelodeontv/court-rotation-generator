const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { test, expect } = require('@playwright/test');

function loadScheduler() {
  const source = fs.readFileSync('scheduler.js', 'utf8');
  const sandbox = { window: {}, performance, Date, Math, Set, Map, Number, String, Object, Array };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { timeout: 3000 });
  return sandbox.window.RotationScheduler;
}

test('scheduler always returns a complete rotation for realistic rosters', () => {
  const scheduler = loadScheduler();
  for (const count of [16, 20, 24]) {
    const players = Array.from({ length: count }, (_, i) => i + 1);
    const skills = new Map(players.map((p, i) => [p, i % 3 === 0 ? 'Beginner' : i % 3 === 1 ? 'Intermediate' : 'Advanced']));
    const started = performance.now();
    const result = scheduler.generate({
      players,
      per: 6,
      targets: new Map(players.map(p => [p, 6])),
      courts: 1,
      rest: 'balanced',
      seed: 123456,
      skills,
      attempts: 420,
    });
    const elapsed = performance.now() - started;
    expect(result?.games?.length, `${count} players returned an incomplete schedule`).toBe(Math.floor(count * 6 / 4));
    expect(elapsed, `${count} players exceeded the hard test ceiling`).toBeLessThan(2500);
  }
});


test('skill-balanced pairing minimizes combined star-total difference', () => {
  const scheduler = loadScheduler();
  const players = [1, 2, 3, 4];
  const skills = new Map([[1, 'Beginner'], [2, 'Advanced Beginner'], [3, 'Advanced'], [4, 'Expert']]);
  const result = scheduler.generate({
    players,
    per: 1,
    targets: new Map(players.map(p => [p, 1])),
    courts: 1,
    rest: 'balanced',
    seed: 24680,
    skills,
    attempts: 2,
    timeBudgetMs: 700,
  });
  expect(result?.games).toHaveLength(1);
  const sums = result.games[0].teams.map(team => team.reduce((sum, p) => sum + scheduler.skillValue(skills.get(p)), 0)).sort((a, b) => a - b);
  expect(sums).toEqual([7, 7]);
});
