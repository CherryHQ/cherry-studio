import { join } from 'node:path'

import { expect, test } from './fixture'
import { dismissOnboarding } from './helpers'
import { closeSettings, ensureCustomChatProvider, openSettingsSection } from './models'
import {
  openExternalText,
  selectExternalText,
  sendSystemHotkey
} from '../../../scripts/cherry-regression-test/system-automation'

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

test('[C-02] 使用快捷助手完成全局问答 @quick-assistant', async ({ app, mainWindow: page }) => {
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

test('[C-03] 使用划词助手处理跨应用选中文本 @selection-assistant', async ({ app, mainWindow: page }) => {
  const providerId = await ensureCustomChatProvider(app, page)

  await page.getByRole('button', { name: 'Selection Assistant', exact: true }).click()
  await page.evaluate(
    async ({ model, providerId }) => {
      await window.api.preference.setMultiple({
        'chat.default_model_id': `${providerId}::${model}`,
        'feature.selection.action_items': [
          {
            enabled: true,
            id: 'regression-label',
            isBuiltIn: false,
            name: 'Read validation label',
            prompt: 'What validation label is printed in the selected sentence? Include the label in your answer.'
          }
        ],
        'feature.selection.enabled': true,
        'feature.selection.trigger_mode': 'shortcut',
        'shortcut.selection.capture_text': {
          binding: ['CommandOrControl', 'Shift', 'K'],
          enabled: true
        }
      })
    },
    { model: app.config.customProvider.chatModel, providerId }
  )
  await expect(page.getByRole('switch').first()).toHaveAttribute('aria-checked', 'true')
  await closeSettings(page)

  const selection = await app.window('/windows/selection/toolbar/')
  const readLabel = selection.getByRole('button', { name: 'Read validation label', exact: true })
  await expect(readLabel).toBeVisible()
  await selection.evaluate(() => {
    document.body.dataset.selectedText = ''
    document.body.dataset.toolbarVisible = 'false'
    window.api.ipcApi.on('selection.text_selected', (selectionData) => {
      document.body.dataset.selectedText = (selectionData as { text: string }).text
    })
    window.api.ipcApi.on('selection.toolbar_visibility_change', (isVisible) => {
      document.body.dataset.toolbarVisible = String(isVisible)
    })
  })
  openExternalText(app.record.platform, app.paths, join(app.paths.fixtures, 'selection.txt'))
  await expect
    .poll(
      async () => {
        selectExternalText(app.record.platform)
        sendSystemHotkey(app.record.platform, [app.record.platform === 'macos' ? 'Meta' : 'Control', 'Shift', 'k'])
        await selection.waitForTimeout(1_000)
        return selection.locator('body').getAttribute('data-selected-text')
      },
      { timeout: 15_000 }
    )
    .toContain('SELECTION_ASSISTANT_PASS')
  await expect(selection.locator('body')).toHaveAttribute('data-toolbar-visible', 'true')
  await readLabel.click()
  const action = await app.window('/windows/selection/action/')
  await expect(action.locator('body')).toContainText('SELECTION_ASSISTANT_PASS', { timeout: 2 * 60_000 })
  await expect(action.locator('body')).not.toContainText('Invalid signature')
  await action.keyboard.press('Escape')
})
