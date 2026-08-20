import { test, expect } from '@playwright/test';
import { collectPageErrors, seedDrawState } from '../helpers/state-fixtures.js';

function rotationFromMatrix(matrix) {
  const values = matrix.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number);
  if (!values) return 0;
  const angle = Math.atan2(values[1], values[0]) * 180 / Math.PI;
  return ((angle % 360) + 360) % 360;
}

test.describe('modular Wheel integration', () => {
  test.beforeEach(async ({ page }) => {
    await seedDrawState(page, { visualMode: 'wheel', durationValue: 2 });
    await page.goto('/draw.html');
  });

  test('round preserves canonical labels and Remove deletes exactly the landed sector', async ({ page }) => {
    const errors = collectPageErrors(page);
    const labelsBefore = await page.locator('#wheelSvg .wheel-label').allTextContents();
    const matrixBefore = await page.locator('#wheelSvg').evaluate(element => getComputedStyle(element).transform);

    await page.locator('#startRoundBtn').click();

    await expect(page.locator('#wheelSvg .wheel-label')).toHaveText(labelsBefore);
    const matrixAfterStart = await page.locator('#wheelSvg').evaluate(element => getComputedStyle(element).transform);
    expect(matrixAfterStart).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
    expect(matrixBefore).not.toBe('none');
    await expect(page.locator('#wheelResultPopup')).toHaveClass(/show/);

    const finalMatrix = await page.locator('#wheelSvg').evaluate(element => getComputedStyle(element).transform);
    const rotation = rotationFromMatrix(finalMatrix);
    const sectorAngle = 360 / labelsBefore.length;
    const landedIndex = Math.min(
      labelsBefore.length - 1,
      Math.floor((((-rotation + 90) % 360 + 360) % 360) / sectorAngle)
    );
    const expected = labelsBefore.filter((_, index) => index !== landedIndex);
    await page.locator('#wheelRemoveBtn').click();

    await expect(page.locator('#wheelSvg .wheel-label')).toHaveText(expected);
    expect(errors).toEqual([]);
  });

  test('Keep changes neither copies nor canonical label order', async ({ page }) => {
    const labelsBefore = await page.locator('#wheelSvg .wheel-label').allTextContents();
    const stateBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')));

    await page.locator('#startRoundBtn').click();
    await expect(page.locator('#wheelResultPopup')).toHaveClass(/show/);
    await page.locator('#wheelKeepBtn').click();

    await expect(page.locator('#wheelSvg .wheel-label')).toHaveText(labelsBefore);
    const stateAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')));
    expect(stateAfter.games).toEqual(stateBefore.games);
  });

  test('reduced motion lands on the selected target within 500 ms', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();

    await page.locator('#startRoundBtn').click();

    await expect(page.locator('#wheelResultPopup')).toHaveClass(/show/, { timeout: 500 });
    const selectedName = await page.locator('#wheelResultName').textContent();
    expect(await page.locator('#wheelSvg .wheel-label').allTextContents()).toContain(selectedName);
  });
});
