import { join } from 'node:path'

import { expect, test } from './fixture'
import { dismissOnboarding } from './helpers'
import { closeSettings, CUSTOM_CHAT_PROVIDER, ensureCustomChatProvider, openSettingsSection } from './models'
import { openExternalText, sendSystemHotkey } from '../../../scripts/cherry-regression-test/system-automation'

async function configureQuickAssistant(page: Parameters<typeof dismissOnboarding>[0], model: string): Promise<void> {
  await page.evaluate(() => window.api.preference.set('feature.quick_assistant.enabled', true))
  await openSettingsSection(page, 'Quick Assistant')
  const enabled = page.getByRole('switch').first()
  await expect(enabled).toHaveAttribute('aria-checked', 'true')
  const usageMethod = page.getByRole('group', { name: 'Usage Method', exact: true })
  await expect(usageMethod).toBeVisible()
  const defaultModel = usageMethod.getByRole('radio', { name: 'Default Model', exact: true })
  if ((await defaultModel.getAttribute('aria-checked')) !== 'true') await defaultModel.click()
  await page.getByRole('button', { name: 'Go to model settings', exact: true }).click()
  await page.locator('[data-selector-shell-root="true"]:visible > button').first().click()
  await page.getByTestId('model-selector-search').fill(model)
  await page.getByRole('option').filter({ hasText: model }).filter({ hasText: CUSTOM_CHAT_PROVIDER }).click()

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
  sendSystemHotkey(platform, platform === 'macos' ? ['Meta', 'e'] : ['Control', 'e'])
  const quick = await app.window('/windows/quickassistant/')
  const input = quick.getByRole('textbox').first()
  await expect(input).toBeVisible()
  await input.fill(markerPrompt)
  await input.press('Enter')
  await expect(quick.getByText('QUICK_ASSISTANT_PASS', { exact: true }).last()).toBeVisible({ timeout: 2 * 60_000 })
  await quick.keyboard.press('Escape')
  await expect(quick.getByText('Answer this question', { exact: true })).toBeVisible()
}

test('[C-02] 使用快捷助手完成全局问答 @quick-assistant', async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await configureQuickAssistant(page, app.config.customProvider.chatModel)
  await closeSettings(page)

  const prompt = 'Reply with exactly QUICK_ASSISTANT_PASS and nothing else.'
  await invokeQuickAssistant(app, prompt)
  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await invokeQuickAssistant(app, prompt)
})

test('[C-03] 使用划词助手处理跨应用选中文本 @selection-assistant', async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await openSettingsSection(page, 'Default Model')
  await page.locator('[data-selector-shell-root="true"]:visible > button').first().click()
  await page.getByTestId('model-selector-search').fill(app.config.customProvider.chatModel)
  await page
    .getByRole('option')
    .filter({ hasText: app.config.customProvider.chatModel })
    .filter({ hasText: CUSTOM_CHAT_PROVIDER })
    .click()

  await page.getByRole('button', { name: 'Selection Assistant', exact: true }).click()
  await page.evaluate(async () => {
    await window.api.preference.setMultiple({
      'feature.selection.enabled': true,
      'feature.selection.trigger_mode': 'shortcut',
      'shortcut.selection.capture_text': {
        binding: ['CommandOrControl', 'Shift', 'S'],
        enabled: true
      }
    })
  })
  await expect(page.getByRole('switch').first()).toHaveAttribute('aria-checked', 'true')
  await closeSettings(page)

  openExternalText(app.record.platform, app.paths, join(app.paths.fixtures, 'selection.txt'))
  sendSystemHotkey(app.record.platform, [app.record.platform === 'macos' ? 'Meta' : 'Control', 'Shift', 's'])
  const selection = await app.window('/windows/selection/')
  await expect(selection.getByText('Explain', { exact: true })).toBeVisible()
  await expect(selection.getByText('Translate', { exact: true })).toBeVisible()
  await selection.getByText('Explain', { exact: true }).click()
  const action = await app.window('/windows/selection/action/')
  await expect(action.locator('body')).toContainText('SELECTION_ASSISTANT_PASS', { timeout: 2 * 60_000 })
  await expect(action.locator('body')).not.toContainText('Invalid signature')
  await action.keyboard.press('Escape')
})
