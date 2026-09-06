import { expect, test } from './fixture'
import { CUSTOM_ASSISTANT, ensureCustomAssistant } from './assistants'
import { dismissOnboarding, selectSidebarApp } from './helpers'
import {
  closeSettings,
  CUSTOM_CHAT_PROVIDER,
  ensureCustomChatProvider,
  selectChatModel,
  sendChatMarker
} from './models'

test('[M-02] 配置自定义聊天服务商并完成聊天 @custom-provider-chat', async ({ app, mainWindow }) => {
  let page = mainWindow
  await ensureCustomChatProvider(app, page)
  await expect(page.getByText(CUSTOM_CHAT_PROVIDER, { exact: true }).first()).toBeVisible()
  await expect(page.getByText(app.config.customProvider.chatModel, { exact: true }).last()).toBeVisible()

  await closeSettings(page)
  await selectChatModel(page, app.config.customProvider.chatModel)
  await sendChatMarker(
    page,
    'Reply with exactly CUSTOM_PROVIDER_CHAT_PASS and nothing else.',
    'CUSTOM_PROVIDER_CHAT_PASS'
  )

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Model Provider', exact: true }).click()
  await expect(page.getByText(CUSTOM_CHAT_PROVIDER, { exact: true }).first()).toBeVisible()
})

test('[C-01] 创建自定义助手并聊天 @custom-assistant', async ({ app, mainWindow: page }) => {
  await ensureCustomAssistant(app, page)
  await sendChatMarker(page, 'In one sentence, what is two plus two?', 'ASSISTANT_PROMPT_PASS', false)

  const restarted = await app.restart('authenticated')
  await dismissOnboarding(restarted)
  await selectSidebarApp(restarted, 'Chat')
  const assistantList = restarted.locator('[data-ui="chat.view"]:visible').getByRole('listbox').first()
  await expect(assistantList).toBeVisible()
  await assistantList.getByText(CUSTOM_ASSISTANT, { exact: true }).first().click({ noWaitAfter: true })
  await expect(restarted.getByText('ASSISTANT_PROMPT_PASS').last()).toBeVisible()
})
