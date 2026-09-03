import { chromium } from 'playwright';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { finish, fixture, open, OUT, wait } from './record.mjs';

const scene = '06-product';
const statePath = join(OUT, '06-account-state.json');
const appUrl = 'https://livepreview.liha.dev';
const apiUrl = 'https://api-livepreview.liha.dev';

async function prepareAccount() {
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    const prepared = await page.evaluate(
      async ({ apiUrl, slug }) => {
        const request = async (path, init = {}) => {
          const response = await fetch(`${apiUrl}${path}`, {
            ...init,
            credentials: 'include',
            headers: {
              'x-liha-app': '1',
              ...(init.body ? { 'content-type': 'application/json' } : {}),
            },
          });
          if (!response.ok) throw new Error(`request failed: ${response.status}`);
          return response.json();
        };

        await request('/api/previews/demo', { method: 'POST' });
        await request(`/api/previews/${slug}/comments`, {
          method: 'POST',
          body: JSON.stringify({
            authorName: 'Mika (product)',
            body: 'The updated mobile spacing looks ready to ship.',
          }),
        });
        const me = await request('/api/me');
        const previews = await request('/api/me/previews');
        const activity = await request('/api/me/activity');
        return {
          hasAccount: Boolean(me.account),
          previewCount: previews.previews.length,
          activityCount: activity.activity.length,
        };
      },
      { apiUrl, slug: fixture.slug },
    );
    if (!prepared.hasAccount || prepared.previewCount < 2 || prepared.activityCount < 1) {
      throw new Error(`account preparation incomplete: ${JSON.stringify(prepared)}`);
    }
    await context.storageState({ path: statePath });
  } finally {
    await context.close();
    await browser.close();
  }
}

await rm(statePath, { force: true });
await prepareAccount();

const handle = await open(scene, { storageState: statePath });
try {
  await handle.page.goto(`${appUrl}/me`, { waitUntil: 'domcontentloaded' });
  await handle.page.getByRole('heading', { name: 'Previews' }).waitFor();
  await handle.page.getByText('Northwind landing page', { exact: false }).first().waitFor();
  await wait(4_000);
  await handle.page.mouse.wheel(0, 520);
  await wait(5_500);
} finally {
  await finish(handle, scene);
  await rm(statePath, { force: true });
}
