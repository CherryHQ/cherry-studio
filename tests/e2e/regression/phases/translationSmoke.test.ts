import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { expect, test } from '../fixture'
import { ensureCustomChatProvider, selectVisibleModel } from '../helpers/models'
import { selectSidebarApp } from '../helpers/navigation'
import { closeSettings } from '../helpers/settings'

async function selectTranslationModel(
  page: Parameters<typeof selectSidebarApp>[0],
  model: string,
  providerId: string
): Promise<void> {
  await selectSidebarApp(page, 'Translation')
  await page.locator('[data-ui~="translate.view"] [data-selector-shell-root="true"] > button').click()
  await selectVisibleModel(page, model, providerId)
  const targetLanguage = page.getByRole('button', { name: /^Target Language\b/ })
  if (!(await targetLanguage.textContent())?.includes('Chinese')) {
    await targetLanguage.click()
    await page.getByRole('option').filter({ hasText: 'Chinese' }).first().click({ force: true })
    await expect(targetLanguage).toContainText('Chinese')
  }
}

test(...caseDefinition('T-01'), async ({ app, mainWindow: page }) => {
  const providerId = await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  await selectTranslationModel(page, app.config.customProvider.chatModel, providerId)

  const input = page.locator('[data-ui~="translate.input"] textarea')
  await input.fill('CherryStudio Neptune 27182 TRANSLATION_MARKER')
  await page.locator('[data-ui~="translate.view"]').getByRole('button', { name: 'Translate', exact: true }).click()
  const output = page.locator('[data-ui~="translate.output"]')
  await expect(output).toContainText('27182', { timeout: 2 * 60_000 })

  await page.getByRole('button', { name: 'Translation History', exact: true }).click()
  await expect(page.getByText('CherryStudio Neptune 27182 TRANSLATION_MARKER', { exact: true }).last()).toBeVisible()
})
