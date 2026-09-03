import { clickSlowly, finish, fixture, open, wait } from './record.mjs';

const scene = '07-closing';
const handle = await open(scene);

try {
  await handle.page.goto(fixture.ownerUrl, { waitUntil: 'domcontentloaded' });
  await handle.page.frameLocator('iframe[title="Preview content"]').locator('#cta').waitFor();

  const version = handle.page.getByRole('combobox', { name: 'Version' });
  if (await version.count()) {
    const v2 = await version
      .locator('option')
      .evaluateAll(
        (options) => options.find((option) => option.textContent?.includes('v2'))?.value,
      );
    if (v2) await version.selectOption(v2);
  }

  const openComments = handle.page.getByRole('button', { name: /Open [1-9]/ });
  if (await openComments.isVisible().catch(() => false)) {
    await clickSlowly(handle.page, openComments);
    const addedForScene6 = handle.page.getByText(
      'The updated mobile spacing looks ready to ship.',
      { exact: false },
    );
    if (await addedForScene6.isVisible().catch(() => false)) {
      await clickSlowly(handle.page, addedForScene6.first());
    }
    const resolve = handle.page.getByRole('button', { name: 'Resolve', exact: true });
    if (await resolve.isVisible().catch(() => false)) {
      await clickSlowly(handle.page, resolve);
      await handle.page.getByRole('button', { name: 'Open 0' }).waitFor();
    }
  }

  const resolved = handle.page.getByRole('button', { name: /Resolved [1-9]/ });
  if (await resolved.isVisible().catch(() => false)) {
    await clickSlowly(handle.page, resolved);
  }
  const agentReply = handle.page.getByText('I’d reduce .cta', { exact: false });
  if (await agentReply.isVisible().catch(() => false)) {
    await clickSlowly(handle.page, agentReply.first(), { steps: 8, settle: 300 });
  }
  await wait(9_500);
} finally {
  await finish(handle, scene);
}
