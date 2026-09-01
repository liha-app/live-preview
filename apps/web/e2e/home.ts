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
