import { join } from 'node:path'

import { caseDefinition } from '../../../scripts/cherry-regression-test/cases'
import {
  closeExternalText,
  openExternalText,
  sendSystemHotkey
} from '../../../scripts/cherry-regression-test/systemAutomation'
import { expect, test } from './fixture'
import { ensureCustomChatProvider } from './models'
import { dismissOnboarding } from './navigation'
import { closeSettings, openSettingsSection } from './settings'

test.afterEach(({ app }) => closeExternalText(app.record.platform))

async function configureQuickAssistant(
  page: Parameters<typeof dismissOnboarding>[0],
  providerId: string,
  model: string
): Promise<void> {
  await page.evaluate(() => window.api.preference.set('feature.quick_assistant.enabled', false))
  await page.evaluate(
    ({ providerId, model }) =>
      window.api.preference.setMultiple({
        'feature.quick_assistant.enabled': true,
        'feature.quick_assistant.model_id': `${providerId}::${model}`,
        'shortcut.quick_assistant.toggle': {
          binding: ['CommandOrControl', 'Alt', 'Shift', 'E'],
          enabled: true
        }
      }),
    { model, providerId }
  )
  await openSettingsSection(page, 'Quick Assistant')
  const enabled = page.getByRole('switch').first()
  await expect(enabled).toHaveAttribute('aria-checked', 'true')
  const usageMethod = page.getByRole('group', { name: 'Usage Method', exact: true })
  await expect(usageMethod).toBeVisible()
  const defaultModel = usageMethod.getByRole('radio', { name: 'Default Model', exact: true })
  if ((await defaultModel.getAttribute('aria-checked')) !== 'true') await defaultModel.click()

  await page.getByRole('button', { name: 'Keyboard Shortcuts', exact: true }).click()
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByPlaceholder('Search shortcuts').fill('Quick Assistant')
  const shortcut = page.getByRole('switch').first()
  if ((await shortcut.getAttribute('aria-checked')) !== 'true') await shortcut.click()
  await page.keyboard.press('Escape')
}

async function invokeQuickAssistant(
  app: Parameters<typeof ensureCustomChatProvider>[0],
  markerPrompt: string
): Promise<void> {
  const { platform } = app.record
  openExternalText(platform, app.paths, join(app.paths.fixtures, 'selection.txt'))
  sendSystemHotkey(platform, platform === 'macos' ? ['Meta', 'Alt', 'Shift', 'e'] : ['Control', 'Alt', 'Shift', 'e'])
  const quick = await app.window('/windows/quickassistant/')
  const input = quick.getByRole('textbox').first()
  await expect(input).toBeVisible()
  const marker = quick.getByText('QUICK_ASSISTANT_PASS', { exact: true }).last()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await input.fill(markerPrompt)
    await input.press('Enter')
    const visible = await marker
      .waitFor({ state: 'visible', timeout: 2 * 60_000 })
      .then(() => true)
      .catch(() => false)
    if (visible) break
    const pause = quick.getByRole('button', { name: 'ESC to pause', exact: true })
    if (await pause.isVisible().catch(() => false)) await pause.click()
  }
  await expect(marker).toBeVisible()
  await quick.getByRole('button', { name: 'ESC to return', exact: true }).click()
  await expect(quick.getByText('Answer this question', { exact: true })).toBeVisible()
}

test(...caseDefinition('C-02'), async ({ app, mainWindow: page }) => {
  const providerId = await ensureCustomChatProvider(app, page)
  await configureQuickAssistant(page, providerId, app.config.customProvider.chatModel)
  await closeSettings(page)

  const prompt = 'Reply with exactly QUICK_ASSISTANT_PASS and nothing else.'
  await invokeQuickAssistant(app, prompt)
  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await configureQuickAssistant(page, providerId, app.config.customProvider.chatModel)
  await closeSettings(page)
  await invokeQuickAssistant(app, prompt)
})
