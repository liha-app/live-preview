import { expect, test, type Page } from '@playwright/test';
import { skipIntro, skipAccountPrompt } from './home.js';

/* The offer to sign in is a real dialog, and it lands in front of the next
   click. These suites are about something else. */
test.beforeEach(({ page }) => skipAccountPrompt(page));

/**
 * The sheet that asks for a title and a password before a preview is made.
 *
 * Its dialog is the shared one, so what is checked here holds for every dialog
 * in the app: a modal that re-arms its focus trap on each render steals the
 * caret while you are still typing.
 */
async function openSheet(page: Page) {
  await skipIntro(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Review a URL' }).click();
  await page.getByRole('textbox', { name: /review a URL/i }).fill('https://example.com/landing');
  await page.getByRole('button', { name: 'Import' }).click();

  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('the create sheet', () => {
  test('keeps the caret where it was put while typing a password', async ({ page }) => {
    await openSheet(page);

    const password = page.getByPlaceholder('At least 6 characters');
    await password.click();
    // One key at a time, like a person: the bug needed a render between them.
    await password.pressSequentially('hunter2', { delay: 60 });

    await expect(password).toBeFocused();
    await expect(password).toHaveValue('hunter2');
    // The title is the first field in the dialog, so that is where a re-armed
    // focus trap used to dump everything after the first character.
    await expect(page.getByPlaceholder('Checkout redesign')).toHaveValue('');
  });

  test('keeps the caret while typing a title', async ({ page }) => {
    await openSheet(page);

    const title = page.getByPlaceholder('Checkout redesign');
    await title.click();
    await title.pressSequentially('Checkout v2', { delay: 60 });

    await expect(title).toBeFocused();
    await expect(title).toHaveValue('Checkout v2');
  });

  test('still traps the keyboard and closes on Escape', async ({ page }) => {
    await openSheet(page);

    // Focus starts inside the dialog, not on the page behind it.
    await expect(page.getByPlaceholder('Checkout redesign')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
