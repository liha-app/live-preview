import { expect, test } from '@playwright/test';
import { skipIntro, skipAccountPrompt } from './home.js';

/* The offer to sign in is a real dialog, and it lands in front of the next
   click. These suites are about something else. */
test.beforeEach(({ page }) => skipAccountPrompt(page));

/**
 * The landing page greets a first-time visitor with three sketches, then gets
 * out of the way. It has to open once, close for good, and still be reachable
 * afterwards — a welcome that repeats itself is an obstacle.
 */
test.describe('the introduction', () => {
  test('opens on a first visit and walks its three steps', async ({ page }) => {
    await page.goto('/');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('01 / 03');
    await expect(dialog.getByRole('heading')).toContainText('stable URL');

    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog).toContainText('02 / 03');
    await expect(dialog.getByRole('heading')).toContainText('Mark it up');

    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog).toContainText('03 / 03');

    // The last step offers the sample rather than another "next".
    await expect(dialog.getByRole('button', { name: 'Next' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /open a sample/i })).toBeVisible();
  });

  test('jumps to a step from its marker', async ({ page }) => {
    await page.goto('/');

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Step 3' }).click();
    await expect(dialog).toContainText('03 / 03');
  });

  test('does not come back once it has been seen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('dialog').getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Liha Live Preview' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('is still reachable from the header', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'How it works' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Escape closes it, like every other dialog in the app.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  /*
   * The illustrations are laid out in fixed pixels and scaled to fit. Before
   * that they were laid out in fixed pixels and not scaled, so on a narrow
   * window the right-hand browser sat outside the stage and was clipped away
   * entirely — the arrow pointed at nothing.
   *
   * Measured against the stage, which is what a person can actually see. The
   * frame is 500px wide whatever the window does, so measuring against that
   * proves nothing.
   */
  for (const width of [390, 560, 620, 1280]) {
    test(`keeps every illustration visible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      for (const step of [1, 2, 3]) {
        if (step > 1) await dialog.getByRole('button', { name: `Step ${step}` }).click();

        const clipped = await page.evaluate(() => {
          const stage = document.querySelector('.onboard__stage')?.getBoundingClientRect();
          if (!stage) return ['no stage'];
          return [...document.querySelectorAll('.ob > *')]
            .map((element) => {
              const box = element.getBoundingClientRect();
              const over = Math.max(
                stage.left - box.left,
                box.right - stage.right,
                stage.top - box.top,
                box.bottom - stage.bottom,
              );
              return over > 1
                ? `${element.className || element.tagName} by ${Math.round(over)}px`
                : null;
            })
            .filter(Boolean);
        });

        expect(clipped, `step ${step} at ${width}px`).toEqual([]);
      }
    });
  }

  test('its last step opens the sample review', async ({ page }) => {
    await page.goto('/');

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Step 3' }).click();
    await dialog.getByRole('button', { name: /open a sample/i }).click();

    await page.waitForURL(/\/p\//);
    await expect(page.frameLocator('iframe[title="Preview content"]').locator('h1')).toContainText(
      'Ship faster',
    );
  });
});

/*
 * This is a WebMCP entry, and the landing page is where somebody decides what
 * it is. "An agent reads your feedback" is something an API integration could
 * also claim; that the agent is in the same tab, acting on your screen, is the
 * part that is only true here — and it was the part the page did not say.
 */
test.describe('what the landing page claims', () => {
  test('says the agent is in this browser, and names the door to it', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/');

    await expect(page.locator('.paper__lede')).toContainText(/in the same browser tab/i);
    await expect(page.locator('.decor-comments')).toContainText(/in this tab/i);

    /*
     * A judge does not click an unlabelled sparkle beside a theme toggle. The
     * name has to be on the page, not only in a title attribute — which is
     * where an accessible-name assertion alone would have been satisfied.
     */
    const agent = page.locator('.paper-link--agent');
    await expect(agent).toHaveText(/agent tools/i);
    await agent.click();
    await expect(page.getByRole('dialog')).toContainText(/WebMCP/);
  });
});
