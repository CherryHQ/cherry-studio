import { join } from 'node:path'

import { expect, test } from './fixture'
import { selectSidebarApp } from './helpers'
import { closeSettings, ensureCustomChatProvider, selectVisibleModel } from './models'
import { chooseNativeFile } from '../../../scripts/cherry-regression-test/system-automation'

async function selectTranslationModel(page: Parameters<typeof selectSidebarApp>[0], model: string): Promise<void> {
  await selectSidebarApp(page, 'Translation')
  await page
    .locator(
      '[data-ui="translate.view"] [data-selector-shell-root="true"]:has(+ button[aria-label="Translation History"]) > button'
    )
    .click()
  await selectVisibleModel(page, model)
  const sourceLanguage = page.getByRole('button', { name: 'Source Language' })
  if (!(await sourceLanguage.textContent())?.includes('English')) {
    await sourceLanguage.click()
    await page.getByRole('option').filter({ hasText: 'English' }).first().click({ force: true })
    await expect(sourceLanguage).toContainText('English')
  }
  const targetLanguage = page.getByRole('button', { name: /^Target Language\b/ })
  if (!(await targetLanguage.textContent())?.includes('Chinese')) {
    await targetLanguage.click()
    await page.getByRole('option').filter({ hasText: 'Chinese' }).first().click({ force: true })
    await expect(targetLanguage).toContainText('Chinese')
  }
}

test('[T-01] 文本翻译 @translation', async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  await selectTranslationModel(page, app.config.customProvider.chatModel)

  const input = page.locator('[data-ui="translate.input"] textarea')
  await input.fill('CherryStudio Neptune 27182 TRANSLATION_MARKER')
  await page.locator('[data-ui="translate.view"]').getByRole('button', { name: 'Translate', exact: true }).click()
  const output = page.locator('[data-ui="translate.output"]')
  await expect(output).toContainText('27182', { timeout: 2 * 60_000 })

  await page.getByRole('button', { name: 'Translation History', exact: true }).click()
  await expect(page.getByText('CherryStudio Neptune 27182 TRANSLATION_MARKER', { exact: true }).last()).toBeVisible()
})

test('[T-02] PDF 文件翻译 @translation', async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  await selectTranslationModel(page, app.config.customProvider.chatModel)

  const clear = page.getByText('Clear', { exact: true })
  if (await clear.isVisible().catch(() => false)) await clear.click()

  await page.getByRole('button', { name: 'Drop or click to upload image/document', exact: true }).click()
  await page.waitForTimeout(1_000)
  chooseNativeFile(app.record.platform, app.paths, join(app.paths.fixtures, 'translation.pdf'))

  await expect(page.getByText('PDF detected', { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.locator('[data-ui="translate.view"]').getByRole('button', { name: 'Translate', exact: true }).click()
  await expect(page.locator('[data-ui="translate.output"]')).toContainText('PDF_TRANSLATION_MARKER_314159', {
    timeout: 2 * 60_000
  })
})
