import { test, expect } from '@playwright/test';
import { collectPageErrors, seedDrawState } from '../helpers/state-fixtures.js';

test.describe('modular Battle integration', () => {
  test.beforeEach(async ({ page }) => {
    await seedDrawState(page, { visualMode: 'battle' });
    await page.addInitScript(() => {
      window.__GAME_WHEEL_TEST__ = {
        battle: { hpOverride: 1, hitCooldownMs: 0, damageMin: 1, damageMax: 1 }
      };
      window.__battleFrameCount = 0;
      const requestFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => requestFrame(timestamp => {
        window.__battleFrameCount += 1;
        callback(timestamp);
      });
    });
    await page.goto('/draw.html');
  });

  test('combat locks modes, commits once after completion, and shows the survivor', async ({ page }) => {
    const errors = collectPageErrors(page);
    const gamesBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')).games);

    await page.locator('#startRoundBtn').click();

    const activeSnapshot = await page.evaluate(() => ({
      active: document.querySelector('#battleMachine').classList.contains('active'),
      modesDisabled: ['slotViewBtn', 'wheelViewBtn', 'battleViewBtn']
        .map(id => document.getElementById(id).disabled)
    }));
    expect(activeSnapshot).toEqual({ active: true, modesDisabled: [true, true, true] });
    const provisionalGames = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')).games);
    expect(provisionalGames).toEqual(gamesBefore);
    await expect(page.locator('#winnerBanner')).toHaveClass(/show/);
    const committed = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')));
    expect(committed.games).toHaveLength(1);
    await expect(page.locator('#winnerName')).toHaveText(committed.games[0].name);
    expect(errors).toEqual([]);
  });

  test('pagehide cancels the owned animation frame', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.locator('#startRoundBtn').click();
    await page.waitForTimeout(25);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const frameCount = await page.evaluate(() => window.__battleFrameCount);

    await page.waitForTimeout(100);

    expect(await page.evaluate(() => window.__battleFrameCount)).toBe(frameCount);
    expect(errors).toEqual([]);
  });
});
