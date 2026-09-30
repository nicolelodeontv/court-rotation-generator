const { test, expect } = require('@playwright/test');

const roster = count => Array.from({ length: count }, (_, i) => 'Player ' + (i + 1)).join('\n');

async function generateSession(page, playerCount = 8, courts = 2, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#courts').fill(String(courts));
  await page.locator('#playerPasteBtn').click();
  await page.locator('#pastePlayerNames').fill(roster(playerCount));
  await page.locator('#playerConfirm').click();
  await page.locator('#generateBtn').click();
  if (courts === 1) {
    await expect(page.locator('.live-card')).toBeVisible();
  } else {
    await expect(page.locator('#courtCards')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#courtCards .court-card')).toHaveCount(Math.min(courts, Math.floor(playerCount / 4)));
  }
}

async function readState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('crg-live-state-v1')));
}

async function recordCourtResult(page, court) {
  await page.locator(`[data-court-card="${court}"] [data-action="complete"]`).click();
  await page.locator('[data-winner="0"]').click();
  await page.locator('#scoreA').fill('11');
  await page.locator('#scoreB').fill('7');
  await page.locator('#scoreConfirm').click();
}

test('2 courts render one expanded card per scheduled court', async ({ page }) => {
  await generateSession(page, 8, 2, 390);
  await expect(page.locator('.live-card')).toBeHidden();
  await expect(page.locator('#nextBtn')).toBeHidden();
  for (const court of [1, 2]) {
    await expect(page.locator(`[data-court-card="${court}"]`)).toBeVisible();
    await expect(page.locator(`[data-court-card="${court}"] [data-action="toggle-collapse"]`)).toHaveAttribute('aria-expanded', 'true');
  }
});

test('3 courts render three cards', async ({ page }) => {
  await generateSession(page, 12, 3, 390);
  await expect(page.locator('#courtCards .court-card')).toHaveCount(3);
  for (const court of [1, 2, 3]) {
    await expect(page.locator(`[data-court-card="${court}"]`)).toBeVisible();
  }
});

test('a requested court with no scheduled games is not rendered', async ({ page }) => {
  await generateSession(page, 8, 3, 390);
  const state = await readState(page);
  expect(state.config.effectiveCourts).toBe(2);
  await expect(page.locator('#courtCards .court-card')).toHaveCount(2);
  await expect(page.locator('[data-court-card="3"]')).toHaveCount(0);
});

test('one court keeps the existing single card and has no multi-court container', async ({ page }) => {
  await generateSession(page, 4, 1, 390);
  await expect(page.locator('.live-card')).toBeVisible();
  await expect(page.locator('#courtCards')).toBeHidden();
  await expect(page.locator('#nextBtn')).toBeVisible();
});


test('multi-court sitting-out shows only players absent from all currently playing courts', async ({ page }) => {
  await generateSession(page, 8, 2, 390);
  const state = await readState(page);
  const activePlayers = new Set();
  for (const game of state.games.filter((g, i) => !state.done.includes(i) && Number.isFinite(Number(state.gameStartedAtByIndex[String(i)])))) {
    for (const player of game.teams.flat()) activePlayers.add(player);
  }
  expect(activePlayers.size).toBe(8);
  for (const court of [1, 2]) {
    await expect(page.locator(`[data-court-card="${court}"] .court-card-sit`)).toHaveText('Sitting out: None');
  }
});

test('10-player two-court display lists exactly the players not on either active court', async ({ page }) => {
  await generateSession(page, 10, 2, 390);
  const expected = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('crg-live-state-v1'));
    const playing = new Set();
    data.games.forEach((game, i) => {
      if (!data.done.includes(i) && Number.isFinite(Number(data.gameStartedAtByIndex[String(i)]))) {
        game.teams.flat().forEach(id => playing.add(id));
      }
    });
    return data.names.map((name, i) => ({ id: i + 1, name })).filter(player => !playing.has(player.id)).map(player => player.name);
  });
  expect(expected).toHaveLength(2);
  for (const court of [1, 2]) {
    await expect(page.locator(`[data-court-card="${court}"] .court-card-sit`))
      .toHaveText(expected.length ? `Sitting out: ${expected.join(', ')}` : 'Sitting out: None');
  }
});

test('waiting court lists only idle players and excludes the blocking player who is still playing', async ({ page }) => {
  await generateSession(page, 8, 2, 390);
  await page.evaluate(() => {
    const key = 'crg-live-state-v1';
    const data = JSON.parse(localStorage.getItem(key));
    const activePlayers = data.games[1].teams.flat();
    const overlapPlayer = activePlayers[0];
    const idlePlayers = data.names.map((_, i) => i + 1).filter(id => !activePlayers.includes(id)).slice(0, 3);
    data.games[2].teams = [[overlapPlayer, idlePlayers[0]], [idlePlayers[1], idlePlayers[2]]];
    data.games[2].sitting = data.names.map((_, i) => i + 1).filter(id => !data.games[2].teams.flat().includes(id));
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();
  await recordCourtResult(page, 1);

  const waiting = await readState(page);
  const blockerId = Number(waiting.waitingCourts['1'].player);
  const blockerName = waiting.names[blockerId - 1];
  const idleNames = waiting.names.map((name, i) => ({ id: i + 1, name }))
    .filter(player => player.id !== blockerId && !waiting.games[1].teams.flat().includes(player.id))
    .map(player => player.name);

  await expect(page.locator('[data-court-card="1"] .court-card-status')).toHaveText('WAITING');
  await expect(page.locator('[data-court-card="1"] .court-card-sit')).toHaveText(`Sitting out: ${idleNames.join(', ')}`);
  await expect(page.locator('[data-court-card="1"] .court-card-sit')).not.toContainText(blockerName);
});

test('players marked unavailable remain listed as sitting out when they are not on a playing court', async ({ page }) => {
  await generateSession(page, 10, 2, 390);
  const state = await readState(page);
  const playing = new Set();
  state.games.forEach((game, i) => {
    if (!state.done.includes(i) && Number.isFinite(Number(state.gameStartedAtByIndex[String(i)]))) {
      game.teams.flat().forEach(id => playing.add(id));
    }
  });
  const restingId = state.names.map((_, i) => i + 1).find(id => !playing.has(id));
  expect(restingId).toBeTruthy();

  await page.evaluate(id => {
    const key = 'crg-live-state-v1';
    const data = JSON.parse(localStorage.getItem(key));
    data.active = data.active.filter(playerId => playerId !== id);
    localStorage.setItem(key, JSON.stringify(data));
  }, restingId);
  await page.reload();

  const restingName = (await readState()).names[restingId - 1];
  await expect(page.locator('.court-card-sit').first()).toContainText(restingName);
});

test('single-court sitting-out display remains sourced from the existing game sitting list', async ({ page }) => {
  await generateSession(page, 5, 1, 390);
  await page.evaluate(() => {
    const key = 'crg-live-state-v1';
    const data = JSON.parse(localStorage.getItem(key));
    data.games[0].sitting = [5];
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();

  await expect(page.locator('#currentSit')).toHaveText('Sitting out: Player 5');
  await expect(page.locator('#courtCards')).toBeHidden();
});

test('collapse and expand keeps the court timer running while collapsed', async ({ page }) => {
  await generateSession(page, 8, 2, 390);
  const card = page.locator('[data-court-card="1"]');
  const timer = card.locator('[data-timer-index]').first();
  const before = await timer.textContent();
  await card.locator('[data-action="toggle-collapse"]').click();
  await expect(card.locator('[data-action="toggle-collapse"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(card).toHaveClass(/is-collapsed/);
  await page.waitForTimeout(2200);
  const after = await timer.textContent();
  expect(after).not.toBe(before);
  await card.locator('[data-action="toggle-collapse"]').click();
  await expect(card.locator('[data-action="toggle-collapse"]')).toHaveAttribute('aria-expanded', 'true');
});

test('complete on court 2 records only that game while court 1 timer keeps running', async ({ page }) => {
  await generateSession(page, 8, 2, 390);
  const before = await readState(page);
  const court1Index = before.games.findIndex(g => Number(g.court || 1) === 1);
  const court2Index = before.games.findIndex(g => Number(g.court || 1) === 2);
  const court1Started = Number(before.gameStartedAtByIndex[String(court1Index)]);
  expect(Number.isFinite(court1Started)).toBeTruthy();

  const timer = page.locator(`[data-court-card="1"] [data-timer-index="${court1Index}"]`);
  const timerBefore = await timer.textContent();
  await recordCourtResult(page, 2);

  const after = await readState(page);
  expect(after.done).toContain(court2Index);
  expect(Number(after.gameStartedAtByIndex[String(court1Index)])).toBe(court1Started);
  await page.waitForTimeout(1100);
  const timerAfter = await timer.textContent();
  expect(timerAfter).not.toBe(timerBefore);
});

test('waiting card shows the blocking player and court, then starts after the block clears', async ({ page }) => {
  await generateSession(page, 8, 2, 390);
  await page.evaluate(() => {
    const key = 'crg-live-state-v1';
    const data = JSON.parse(localStorage.getItem(key));
    const activePlayers = data.games[1].teams.flat();
    const overlapPlayer = activePlayers[0];
    const others = data.names.map((_, i) => i + 1).filter(id => !activePlayers.includes(id)).slice(0, 3);
    data.games[2].teams = [[overlapPlayer, others[0]], [others[1], others[2]]];
    data.games[2].sitting = data.names.map((_, i) => i + 1).filter(id => !data.games[2].teams.flat().includes(id));
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();
  await recordCourtResult(page, 1);

  const waiting = await readState(page);
  const blockerName = waiting.names[Number(waiting.waitingCourts['1'].player) - 1];
  await expect(page.locator('[data-court-card="1"]')).toContainText('WAITING FOR PLAYERS');
  await expect(page.locator('[data-court-card="1"] .court-card-waiting')).toContainText(`Waiting for ${blockerName} (Court 2)`);
  await expect(page.locator('[data-court-card="1"] [data-action="complete"]')).toBeDisabled();
  await expect(page.locator('[data-court-card="2"] [data-action="complete"]')).toBeEnabled();

  await recordCourtResult(page, 2);
  const started = await readState(page);
  expect(Number.isFinite(Number(started.gameStartedAtByIndex['2']))).toBeTruthy();
  await expect(page.locator('[data-court-card="1"] [data-action="complete"]')).toBeEnabled();
  await expect(page.locator('[data-court-card="1"] .court-card-status')).toHaveText('PLAYING');
});

test('multi-court Up Next contains only unfinished non-active games and has no drag handle', async ({ page }) => {
  await generateSession(page, 8, 2, 390);
  const state = await readState(page);
  const activeIndexes = await page.locator('.court-card [data-timer-index]').evaluateAll(nodes => nodes.map(n => Number(n.dataset.timerIndex)));
  const upcomingIndexes = await page.locator('#upNextList .next-item').evaluateAll(nodes => nodes.map(n => Number(n.dataset.upcomingIndex)));
  expect(upcomingIndexes.every(i => !activeIndexes.includes(i))).toBeTruthy();
  for (const idx of upcomingIndexes) {
    expect(state.done).not.toContain(idx);
    expect(Number.isFinite(Number(state.gameStartedAtByIndex[String(idx)]))).toBeFalsy();
  }
  await expect(page.locator('#upNextList .drag-handle')).toHaveCount(0);
  await expect(page.locator('#nextBtn')).toBeHidden();
});

test('nothing overflows horizontally at 360px', async ({ page }) => {
  await generateSession(page, 8, 2, 360, 800);
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    cards: [...document.querySelectorAll('.court-card')].map(card => ({ scroll: card.scrollWidth, client: card.clientWidth }))
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.width);
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.width);
  expect(metrics.cards.every(card => card.scroll <= card.client + 1)).toBeTruthy();
});

test('Court Mode shows multi-court cards inside the existing full-height Live shell', async ({ page }) => {
  await generateSession(page, 8, 2, 1280, 720);
  await page.locator('#courtModeBtn').click();
  await expect(page.locator('body')).toHaveClass(/court-mode/);
  await expect(page.locator('#courtCards .court-card')).toHaveCount(2);
  await expect(page.locator('#courtCards')).toBeVisible();
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.width);
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.width);
});


test('restored multi-court cards paint actual elapsed timers on first render', async ({ page }) => {
  await generateSession(page, 8, 2, 390);
  await page.evaluate(() => {
    const key = 'crg-live-state-v1';
    const data = JSON.parse(localStorage.getItem(key));
    const now = Date.now();
    data.gameStartedAtByIndex['0'] = now - 65000;
    data.gameStartedAtByIndex['1'] = now - 125000;
    localStorage.setItem(key, JSON.stringify(data));
  });

  await page.reload();
  await expect(page.locator('#courtCards')).toBeVisible({ timeout: 5000 });
  const readings = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('crg-live-state-v1'));
    const format = total => {
      const seconds = Math.max(0, Math.floor(Number(total) || 0));
      return Math.floor(seconds / 60).toString().padStart(2, '0') + ':' + (seconds % 60).toString().padStart(2, '0');
    };
    return ['0', '1'].map(index => {
      const started = Number(state.gameStartedAtByIndex[index]);
      const expected = format((Date.now() - started) / 1000);
      const node = document.querySelector('[data-timer-index="' + index + '"]');
      return { index, expected, actual: node?.textContent ?? '' };
    });
  });

  for (const reading of readings) {
    expect(reading.actual).toBe(reading.expected);
  }
});
