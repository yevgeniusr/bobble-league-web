export async function waitPlayerIdentity(page) {
  await page.locator('.identityStrip.guest, .identityStrip.account').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#desk-panel-host .deskSubmit:not([disabled])').waitFor({ state: 'visible', timeout: 30000 });
}
