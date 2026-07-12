export async function waitPlayerIdentity(page) {
  await page.locator('.identityStrip.guest, .identityStrip.account').waitFor({ state: 'visible', timeout: 30000 });
}
