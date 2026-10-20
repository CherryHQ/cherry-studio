import type { BrowserContext, Locator, Page } from '@playwright/test'

/** Port of the Web app's preview server (`build:app`), next to the harness on 4318. */
export const APP_PORT = 4320
const APP_URL = `http://localhost:${APP_PORT}`

/** Opens the Web app and waits for the chat composer, skipping first-run onboarding when it shows. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto(APP_URL)
  const composer = composerInput(page)
  const skipOnboarding = page.getByRole('button', { name: 'Set up later' })
  await composer.or(skipOnboarding).first().waitFor()
  if (await skipOnboarding.isVisible()) await skipOnboarding.click()
  await composer.waitFor()
}

/** The chat input: a plain textarea until the rich editor loads, which WebKit defers to the first focus. */
export function composerInput(page: Page): Locator {
  return page.locator('[data-ui~="part:composer-input"]').first()
}

/**
 * Removes the app's local account. WebKit keeps OPFS outside the profile directory, so it would
 * otherwise outlive the test. A stub document on the app's origin avoids starting the app, whose
 * Worker would hold the database open.
 */
export async function removeAppData(context: BrowserContext): Promise<void> {
  for (const page of context.pages()) await page.close()
  const page = await context.newPage()
  await page.route(`${APP_URL}/__storage`, (route) => route.fulfill({ contentType: 'text/html', body: '' }))
  await page.goto(`${APP_URL}/__storage`)
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    for (let attempt = 1; ; attempt++) {
      try {
        await (await root.getDirectoryHandle('cherry-studio')).removeEntry('local', { recursive: true })
        return
      } catch (error) {
        if ((error as DOMException).name === 'NotFoundError') return
        if (attempt === 20) throw error
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  })
}
