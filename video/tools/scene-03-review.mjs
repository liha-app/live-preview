import { clickSlowly, finish, fixture, open, wait } from './record.mjs';

const scene = '03-review';
const handle = await open(scene);
const { page } = handle;

try {
  await page.goto(fixture.ownerUrl, { waitUntil: 'domcontentloaded' });
  await page.frameLocator('iframe[title="Preview content"]').locator('#cta').waitFor();
  await wait(900);

  const cta = page.frameLocator('iframe[title="Preview content"]').locator('#cta');
  await clickSlowly(page, cta);
  const firstComposer = page.getByRole('dialog', { name: 'Write a comment' });
  await firstComposer.getByText('#cta', { exact: true }).waitFor();
  await firstComposer
    .getByRole('textbox', { name: 'What needs to change?' })
    .pressSequentially('Reduce the padding and type size so the headline stays dominant.', {
      delay: 34,
    });
  await wait(450);
  await clickSlowly(page, firstComposer.getByRole('button', { name: 'Comment' }));
  await page.getByText('Reduce the padding and type size', { exact: false }).waitFor();
  await wait(1_200);

  await clickSlowly(page, page.getByRole('button', { name: 'Box' }));
  const surface = page.locator('.annotation-layer');
  const box = await surface.boundingBox();
  if (!box) throw new Error('annotation surface is not visible');
  const from = { x: box.x + box.width * 0.15, y: box.y + box.height * 0.57 };
  const to = { x: box.x + box.width * 0.83, y: box.y + box.height * 0.75 };
  await page.mouse.move(from.x, from.y, { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.up();

  const secondComposer = page.getByRole('dialog', { name: 'Write a comment' });
  await secondComposer.waitFor();
  await secondComposer
    .getByRole('textbox', { name: 'What needs to change?' })
    .pressSequentially('Give this feature row a little more breathing room on narrow screens.', {
      delay: 31,
    });
  await wait(450);
  await clickSlowly(page, secondComposer.getByRole('button', { name: 'Comment' }));
  await page.getByText('Give this feature row', { exact: false }).waitFor();
  await wait(10_000);
} finally {
  await finish(handle, scene);
}
