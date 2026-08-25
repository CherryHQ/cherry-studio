import { join } from 'node:path'

import { expect, test } from './fixture'
import { selectSidebarApp } from './helpers'
import { closeSettings, ensureCustomChatProvider } from './models'

async function selectTranslationModel(page: Parameters<typeof selectSidebarApp>[0], model: string): Promise<void> {
  await selectSidebarApp(page, 'Translation')
  await page
    .locator(
      '[data-ui="translate.view"] [data-selector-shell-root="true"]:has(+ button[aria-label="Translation History"]) > button'
    )
    .click()
  await page.getByTestId('model-selector-search').fill(model)
  await page.getByRole('option').filter({ hasText: model }).first().click()
  await page.getByRole('button', { name: 'Source Language' }).click()
  await page.getByRole('option').filter({ hasText: 'English' }).first().click()
  await page.getByRole('button', { name: /^Target Language\b/ }).click()
  await page.getByRole('option').filter({ hasText: 'Chinese' }).first().click()
}

test('[T-01] 文本翻译 @translation', async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  await selectTranslationModel(page, app.config.customProvider.chatModel)

  const input = page.locator('[data-ui="translate.input"] textarea')
  await input.fill('CherryStudio Neptune 27182 TRANSLATION_MARKER')
  await page.locator('[data-ui="translate.view"]').getByRole('button', { name: 'Translate', exact: true }).click()
  const output = page.locator('[data-ui="translate.output"]')
  await expect(output).toContainText('Neptune', { timeout: 2 * 60_000 })
  await expect(output).toContainText('27182')
  await expect(output).toContainText('TRANSLATION_MARKER')

  await page.getByRole('button', { name: 'Translation History', exact: true }).click()
  await expect(page.getByText('CherryStudio Neptune 27182 TRANSLATION_MARKER', { exact: true })).toBeVisible()
})

test('[T-02] PDF 文件翻译 @translation', async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  await selectTranslationModel(page, app.config.customProvider.chatModel)

  const clear = page.getByText('Clear', { exact: true })
  if (await clear.isVisible().catch(() => false)) await clear.click()

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Drop or click to upload image/document', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles(join(app.paths.fixtures, 'translation.pdf'))

  const input = page.locator('[data-ui="translate.input"]')
  await expect(input).toContainText('PDF_TRANSLATION_MARKER_314159', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Translate', exact: true }).click()
  await expect(page.locator('[data-ui="translate.output"]')).toContainText('PDF_TRANSLATION_MARKER_314159', {
    timeout: 2 * 60_000
  })
})
