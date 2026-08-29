import { expect, test } from '@playwright/test';
import { seedDrawState } from '../helpers/state-fixtures.js';

test('Mystery mode hides participants and shows elimination then winner popups', async ({ page }) => {
  await seedDrawState(page, {
    games: [
      { id: 1, name: 'Alpha', copies: 1 },
      { id: 2, name: 'Beta', copies: 1 }
    ],
    nextId: 3,
    visualMode: 'mystery',
    durationValue: 2
  });
  await page.goto('/draw.html');

  await expect(page.locator('#participantsDrawer')).toBeHidden();
  await expect(page.locator('#statusLine')).toContainText('У грі: 2');

  await page.locator('#startRoundBtn').click();
  await expect(page.locator('#drawResultPopup')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#drawResultTitle')).toHaveText('Вибуває з розіграшу');

  await page.locator('#drawResultCloseBtn').click();
  await expect(page.locator('#drawResultTitle')).toHaveText('Переможець');
});
