import type { Page } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'

import { caseDefinition } from '../../../scripts/e2e/regression/cases'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { customAssistantName, ensureCustomAssistant } from './assistants'
import { selectChatModel, sendChatMarker } from './chat'
import { expect, test } from './fixture'
import { CUSTOM_CHAT_PROVIDER, ensureCustomChatProvider } from './models'
import { dismissOnboarding, selectSidebarApp } from './navigation'
import { closeSettings, openSettingsSection } from './settings'

test(...caseDefinition('M-02'), async ({ app, mainWindow }) => {
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
  await openSettingsSection(page, 'Model Provider')
  await expect(page.getByText(CUSTOM_CHAT_PROVIDER, { exact: true }).first()).toBeVisible()
})

test(...caseDefinition('M-03'), async ({ app, mainWindow: page }) => {
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const providerId = `regression-model-scroll-${Date.now()}`
  const providerName = app.resourceName('Model scrolling')
  const groupName = app.resourceName('Scroll group')
  const created = await page.evaluate(
    ({ providerId, providerName }) =>
      window.api.dataApi.request({
        id: `${providerId}-create`,
        method: 'POST',
        path: '/providers',
        body: { providerId, name: providerName }
      }),
    { providerId, providerName }
  )
  expect(created.status).toBe(201)

  try {
    // Seed persisted inputs; scrolling and all assertions go through the real settings UI.
    const seeded = await page.evaluate(
      ({ providerId, groupName }) =>
        window.api.dataApi.request({
          id: `${providerId}-models`,
          method: 'POST',
          path: '/models',
          body: Array.from({ length: 160 }, (_, index) => ({
            providerId,
            modelId: `scroll-${String(index).padStart(3, '0')}`,
            name: `Scroll model ${String(index).padStart(3, '0')}`,
            group: groupName
          }))
        }),
      { providerId, groupName }
    )
    expect(seeded.status).toBe(201)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.reload()

    await openSettingsSection(page, 'Model Provider')
    await page.getByPlaceholder('Search Providers...', { exact: true }).fill(providerName)
    await page.getByTestId(`provider-list-item-${providerId}`).click()
    const detail = page.getByTestId('provider-detail-shell')
    const list = detail.getByTestId('provider-model-list').getByRole('list')
    const firstModel = list.getByText('Scroll model 000', { exact: true })
    const laterModel = list.getByText('Scroll model 060', { exact: true })
    const group = list.getByRole('button', { name: new RegExp(`^${groupName}`) })
    await expect(firstModel).toBeInViewport()
    await expect(group).toBeInViewport()
    await expect(laterModel).not.toBeInViewport()

    const listBox = await list.boundingBox()
    const detailBox = await detail.boundingBox()
    if (!listBox || !detailBox) throw new Error('Provider model list has no visible layout')
    const wheelStep = Math.floor(detailBox.height / 2)
    const pointerY = detailBox.y + detailBox.height / 2
    const outsideX = listBox.x - 12
    expect(outsideX).toBeGreaterThan(detailBox.x)
    await page.mouse.move(outsideX, pointerY)
    await expect(async () => {
      await page.mouse.wheel(0, wheelStep)
      await expect(laterModel).toBeInViewport({ timeout: 500 })
    }).toPass({ timeout: 15_000 })

    await expect(group).not.toBeInViewport()
    await expect(firstModel).not.toBeAttached()

    await page.mouse.move(listBox.x + listBox.width / 2, pointerY)
    await expect(async () => {
      await page.mouse.wheel(0, -wheelStep)
      await expect(firstModel).toBeInViewport({ timeout: 500 })
      await expect(group).toBeInViewport({ timeout: 500 })
    }).toPass({ timeout: 15_000 })
  } finally {
    const removed = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({ id: `${providerId}-delete`, method: 'DELETE', path: `/providers/${providerId}` }),
      providerId
    )
    expect(removed.status).toBe(204)
    const providerSearch = page.getByPlaceholder('Search Providers...', { exact: true })
    if (await providerSearch.isVisible()) await providerSearch.fill('')
    await page.setViewportSize(viewport)
  }
})

test(...caseDefinition('C-01'), async ({ app, mainWindow: page }) => {
  await ensureCustomAssistant(app, page)
  await sendChatMarker(page, 'In one sentence, what is two plus two?', 'ASSISTANT_PROMPT_PASS', false)

  const restarted = await app.restart('authenticated')
  await dismissOnboarding(restarted)
  await selectSidebarApp(restarted, 'Chat')
  const assistantList = restarted.locator('[data-ui="chat.view"]:visible').getByRole('listbox').first()
  await expect(assistantList).toBeVisible()
  await assistantList.getByText(customAssistantName(app), { exact: true }).first().click({ noWaitAfter: true })
  await expect(restarted.getByText('ASSISTANT_PROMPT_PASS').last()).toBeVisible()
})

test(...caseDefinition('C-03'), async ({ app, mainWindow }, testInfo) => {
  const server = await startMockChatServer()
  const providerId = `regression-stream-${Date.now()}`
  const assistantName = app.resourceName('Stream failure')
  const prompt = 'Explain how a rainbow forms.'
  const partialText = 'Sunlight enters a raindrop and separates into colors.'
  let page = mainWindow
  let assistantId: string | undefined
  const namingEnabled = await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))

  try {
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Stream failure mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: `${providerId}-enable`,
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const models = await page.evaluate(
      ({ providerId, modelId }) =>
        window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'stream-failure-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    await page.reload()
    await expect(page.locator('[data-ui~="chat.view"]:visible')).toBeVisible()
    const assistantRow = page
      .locator('[data-ui~="chat.view"]:visible')
      .locator('[data-ui~="chat.group-header"]')
      .filter({ hasText: assistantName })
      .first()
    await assistantRow.hover()
    await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    await page.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first().fill(prompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    const request = await server.nextRequest()
    expect(request.body).toMatchObject({
      model: server.modelId,
      stream: true,
      messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: prompt })])
    })
    request.sendText('Sunlight enters a raindrop ')
    request.sendText('and separates into colors.')
    const response = page
      .locator('[data-ui~="chat.message"][data-message-id]:visible')
      .filter({ hasText: partialText })
      .last()
    await expect(response.getByText(partialText, { exact: true })).toBeVisible()
    await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeVisible()
    const messageId = await response.getAttribute('data-message-id')
    if (!messageId) throw new Error('Streaming response has no message ID')

    // Disconnect only after the renderer has consumed the text, without a finish chunk or [DONE].
    request.disconnect()
    await expect
      .poll(async () => {
        const stored = await page.evaluate(
          (id) => window.api.dataApi.request({ id: 'stream-failure-read', method: 'GET', path: `/messages/${id}` }),
          messageId
        )
        expect(stored.status).toBe(200)
        return MessageSchema.parse(stored.data)
      })
      .toMatchObject({
        id: messageId,
        status: 'error',
        data: {
          parts: expect.arrayContaining([
            expect.objectContaining({ type: 'text', text: partialText, state: 'done' }),
            expect.objectContaining({ type: 'data-error' })
          ])
        }
      })
    await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeHidden()
    await expect(response.getByText(partialText, { exact: true })).toBeVisible()

    page = await app.restart('authenticated')
    await dismissOnboarding(page)
    await expect(page.locator('[data-ui~="chat.view"]:visible')).toBeVisible()
    const restored = page.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]:visible`)
    await expect(restored.getByText(partialText, { exact: true })).toBeVisible()
    const stored = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'stream-failure-reloaded', method: 'GET', path: `/messages/${id}` }),
      messageId
    )
    expect(stored.status).toBe(200)
    expect(MessageSchema.parse(stored.data)).toMatchObject({
      id: messageId,
      status: 'error',
      data: {
        parts: expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: partialText, state: 'done' }),
          expect.objectContaining({ type: 'data-error' })
        ])
      }
    })

    await page.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first().fill('What happens next?')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const recoveryRequest = await server.nextRequest()
    recoveryRequest.complete('The light leaves the raindrop.')
    const recovery = page.locator('[data-ui~="chat.message"][data-message-id]:visible').last()
    await expect(recovery.getByText('The light leaves the raindrop.', { exact: true })).toBeVisible()
    const recoveryId = await recovery.getAttribute('data-message-id')
    if (!recoveryId) throw new Error('Recovery response has no message ID')
    await expect
      .poll(async () => {
        const saved = await page.evaluate(
          (id) => window.api.dataApi.request({ id: 'stream-recovery-read', method: 'GET', path: `/messages/${id}` }),
          recoveryId
        )
        return MessageSchema.parse(saved.data).status
      })
      .toBe('success')
    await testInfo.attach('Restart persistence and recovery', {
      body: await page.screenshot(),
      contentType: 'image/png'
    })
  } finally {
    await server.close()
    page = await app.mainWindow()
    await page.evaluate(
      async ({ assistantId, providerId, namingEnabled }) => {
        await window.api.preference.set('topic.naming.enabled', namingEnabled)
        if (assistantId) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        await window.api.dataApi.request({
          id: `${providerId}-delete`,
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
      },
      { assistantId, providerId, namingEnabled }
    )
  }
})

test(...caseDefinition('SET-05'), async ({ app, mainWindow: page }) => {
  await openSettingsSection(page, 'About')

  // The About page must name the product and show a real version number.
  await expect(page.getByText(/Cherry Studio/i).first()).toBeVisible()
  const version = page.getByText(/\bv?\d+\.\d+\.\d+\b/).first()
  await expect(version).toBeVisible()
  const before = (await version.textContent())?.trim()

  // The value comes from the running build, so it must survive a restart unchanged.
  const restarted = await app.restart('authenticated')
  await openSettingsSection(restarted, 'About')
  await expect(restarted.getByText(/\bv?\d+\.\d+\.\d+\b/).first()).toHaveText(before ?? '')
})

// The sidebar groups conversations by assistant by default; "Time" is the flat list a reader expects.
async function showConversationList(page: Page): Promise<void> {
  const displayMode = page.getByRole('button', { name: 'Display mode', exact: true })
  if (await displayMode.isVisible().catch(() => false)) {
    await displayMode.click()
    const byTime = page.getByText('Time', { exact: true }).first()
    if (await byTime.isVisible().catch(() => false)) await byTime.click()
    else await page.keyboard.press('Escape')
  }
}

async function startTrackedChat(
  app: Parameters<typeof ensureCustomChatProvider>[0],
  page: Parameters<typeof ensureCustomChatProvider>[1]
): Promise<void> {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  await selectChatModel(page, app.config.customProvider.chatModel)
  await showConversationList(page)
}

// Each case starts from an empty conversation; a reused one carries earlier answers into the reply.
async function startFreshChat(
  app: Parameters<typeof ensureCustomChatProvider>[0],
  page: Parameters<typeof ensureCustomChatProvider>[1]
): Promise<void> {
  await startTrackedChat(app, page)
  const create = page.locator('[data-ui~="chat.topic-list.action.create"]:visible').first()
  await create.click()
  await expect(page.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()).toBeVisible()
}

test(...caseDefinition('TOPIC-01'), async ({ app, mainWindow }) => {
  let page = mainWindow
  await startFreshChat(app, page)

  const rows = () => page.locator('[data-testid="topic-list-row"]:visible')
  const firstMarker = 'TOPIC_ONE_PASS_31415'
  const secondMarker = 'TOPIC_TWO_PASS_27182'

  await sendChatMarker(page, `Reply with exactly ${firstMarker} and nothing else.`, firstMarker, false)
  await expect.poll(() => rows().count()).toBeGreaterThan(0)
  const afterFirst = await rows().count()

  await page.locator('[data-ui~="chat.topic-list.action.create"]:visible').first().click()
  await expect.poll(() => rows().count()).toBeGreaterThan(afterFirst)
  await sendChatMarker(page, `Reply with exactly ${secondMarker} and nothing else.`, secondMarker, false)

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await selectSidebarApp(page, 'Chat')
  await showConversationList(page)
  await expect.poll(() => rows().count()).toBeGreaterThanOrEqual(afterFirst + 1)

  // Each conversation must still own its own answer, not just "there are two rows".
  const markers = new Set<string>()
  for (const row of await rows().all()) {
    await row.click()
    const view = await page.locator('[data-ui="chat.view"]:visible').first().innerText()
    if (view.includes(firstMarker)) markers.add(firstMarker)
    if (view.includes(secondMarker)) markers.add(secondMarker)
  }
  expect([...markers].sort()).toEqual([firstMarker, secondMarker].sort())
})

test(...caseDefinition('TOPIC-02'), async ({ app, mainWindow }) => {
  let page = mainWindow
  await startFreshChat(app, page)

  const marker = 'TOPIC_RENAME_PASS_16180'
  await sendChatMarker(page, `Reply with exactly ${marker} and nothing else.`, marker, false)

  const name = app.resourceName('Renamed conversation')
  const row = page.locator('[data-testid="topic-list-row"]:visible').first()
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit conversation name', exact: true }).click()
  const input = page.getByRole('dialog').getByRole('textbox').first()
  await input.fill(name)
  await page.keyboard.press('Enter')
  await expect(row).toContainText(name)

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await selectSidebarApp(page, 'Chat')
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible()

  // The rename must not cost the conversation its messages.
  await page.getByText(name, { exact: true }).first().click()
  await expect(page.getByText(marker, { exact: true }).last()).toBeVisible()
})

test(...caseDefinition('CHAT-01'), async ({ app, mainWindow }) => {
  const page = mainWindow
  await startTrackedChat(app, page)

  const composer = page.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
  await composer.fill('')
  await composer.click()
  await composer.pressSequentially('first line of the draft')
  await page.keyboard.press('Shift+Enter')
  await composer.pressSequentially('second line of the draft')

  const draft = await composer.innerText()
  expect(draft.split('\n').filter(Boolean)).toEqual(['first line of the draft', 'second line of the draft'])
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const sent = page
    .locator('[data-ui~="chat.message"][data-message-id]:visible')
    .filter({ hasText: 'first line of the draft' })
    .last()
  await expect(sent).toContainText('second line of the draft')
  await expect(composer).toHaveText('')
})

test(...caseDefinition('CHAT-02'), async ({ app, mainWindow }) => {
  const page = mainWindow
  await startFreshChat(app, page)

  const marker = 'MESSAGE_ACTION_PASS_27182'
  const messageId = await sendChatMarker(page, `Reply with exactly ${marker} and nothing else.`, marker, false)

  const reply = page.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]`)
  await reply.hover()
  const actions = reply.locator('[data-ui~="part:message-actions"]')
  await expect(actions).toBeVisible()

  await expect(actions.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled()
  await expect(actions.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled()

  await reply.locator('[data-ui~="part:message-actions"]').getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('dialog')
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  }
  await expect(page.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]`)).toHaveCount(0)
})

test(...caseDefinition('SET-01'), async ({ mainWindow: page }) => {
  await openSettingsSection(page, 'General')
  const navigation = page.locator('[data-ui="settings.navigation"]')
  await expect(navigation).toBeVisible()

  // Sections are anchors on one page, so navigation means the section's rows scroll into view.
  const sections: Array<[string, string]> = [
    ['General', 'setting-general-launch-onboot'],
    ['Data', 'setting-data-data-backup-restore'],
    ['Notifications', 'setting-notifications-assistant-notification']
  ]
  for (const [section, anchor] of sections) {
    await navigation.locator('[data-slot="menu-item"]').filter({ hasText: section }).first().click()
    await expect(page.locator(`#${anchor}`)).toBeInViewport()
  }

  await page.getByRole('button', { name: 'Search settings', exact: true }).click()
  const search = page.getByRole('combobox', { name: 'Search settings', exact: true })
  await search.fill('backup')
  await expect(
    page
      .getByRole('option')
      .filter({ hasText: /backup/i })
      .first()
  ).toBeVisible()
})

test(...caseDefinition('SET-02'), async ({ app, mainWindow }) => {
  let page = mainWindow
  await openSettingsSection(page, 'Appearance')

  const switchFor = (target: typeof page) =>
    target.locator('#setting-appearance-code-wrappable').getByRole('switch').first()

  const toggle = switchFor(page)
  await toggle.scrollIntoViewIfNeeded()
  await expect(toggle).toBeVisible()
  const before = await toggle.isChecked()

  await toggle.click()
  await expect(toggle).toBeChecked({ checked: !before })

  // A saved setting must survive an app restart, not just re-render in the open panel.
  page = await app.restart('authenticated')
  await openSettingsSection(page, 'Appearance')
  const restored = switchFor(page)
  await restored.scrollIntoViewIfNeeded()
  await expect(restored).toBeChecked({ checked: !before })

  // Put the value back so later cases start from the shipped default.
  await restored.click()
  await expect(restored).toBeChecked({ checked: before })
})

test(...caseDefinition('SET-03'), async ({ app, mainWindow }) => {
  let page = mainWindow
  await openSettingsSection(page, 'Appearance')

  const row = () => page.locator('#setting-appearance-newline-shortcuts')
  const trigger = () => row().getByRole('combobox').first()
  await row().scrollIntoViewIfNeeded()
  const before = (await trigger().innerText()).trim()

  await trigger().click()
  const options = page.getByRole('option')
  const count = await options.count()
  let picked = ''
  for (let index = 0; index < count; index++) {
    const label = (await options.nth(index).innerText()).trim()
    // Pick any binding other than the current one; the list excludes the send shortcut already.
    if (label && label !== before) {
      picked = label
      await options.nth(index).click()
      break
    }
  }
  expect(picked).not.toBe('')
  await expect(trigger()).toHaveText(picked)

  // The shortcut is a persisted preference: it must come back after a restart.
  page = await app.restart('authenticated')
  await openSettingsSection(page, 'Appearance')
  await row().scrollIntoViewIfNeeded()
  await expect(trigger()).toHaveText(picked)

  // Restore the shipped default so later cases keep the documented Enter/Shift+Enter behavior.
  await trigger().click()
  await page.getByRole('option').filter({ hasText: before }).first().click()
  await expect(trigger()).toHaveText(before)
})
