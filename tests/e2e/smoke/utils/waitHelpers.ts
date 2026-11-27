import type { Page } from '@playwright/test'

/** Wait for either the initial onboarding screen or the configured application shell. */
export async function waitForAppReady(page: Page, timeout: number = 60000): Promise<void> {
  await page
    .locator('[data-onboarding-language-select], [data-ui~="app.content"]')
    .first()
    .waitFor({ state: 'visible', timeout })
}
