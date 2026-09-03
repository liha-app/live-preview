import { clickSlowly, finish, fixture, open, wait } from './record.mjs';

const scene = '01-hook';
const handle = await open(scene);
const { page } = handle;

try {
  await page.goto(fixture.ownerUrl, { waitUntil: 'domcontentloaded' });
  await page.frameLocator('iframe[title="Preview content"]').locator('#cta').waitFor();
  await page.getByText('This button is far too large', { exact: false }).waitFor();
  await wait(1_200);

  await clickSlowly(page, page.locator('.thread__root').first());
  await wait(2_000);

  await clickSlowly(page, page.getByRole('button', { name: 'Agent tools' }));
  await page.getByText(/publishing 13 tools/i).waitFor();
  await wait(4_800);

  await clickSlowly(page, page.getByRole('button', { name: 'Close' }));
  await wait(700);
  await clickSlowly(page, page.getByRole('button', { name: '390px viewport' }));
  await wait(3_600);
} finally {
  await finish(handle, scene);
}
