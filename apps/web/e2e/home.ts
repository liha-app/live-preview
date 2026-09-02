import type { Page } from '@playwright/test';

/**
 * The three-step introduction opens on a first visit, and every Playwright
 * context is a first visit. Tests that are not about the introduction opt out
 * of it explicitly, so the one that is stays meaningful.
 */
export const skipIntro = (page: Page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem('liha.seen-intro', '1');
    } catch {
      /* private mode: the introduction just opens, which is fine */
    }
  });

/**
 * Silences the offer to sign in.
 *
 * It is a real dialog a real person sees after their first action, so a suite
 * about something else has to say it is not that person — otherwise it lands in
 * front of the next click and the failure looks like a broken review screen.
 */
export const skipAccountPrompt = (page: Page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem('liha.no-account-prompt', '1');
    } catch {
      /* private mode: the offer appears, and the test says so */
    }
  });
