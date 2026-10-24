import { writeFile, readFile } from 'node:fs/promises'
import { AssistantSchema } from '@shared/data/types/assistant'
import { type BranchMessagesResponse, MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import { caseDefinition } from '../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { assistantGroupManagement } from './assistantGroupManagement'
import { sendChatMarker } from './chat'
import { expect, test } from './fixture'
import { selectSidebarApp } from './navigation'
import { switchConversationModel } from './switchConversationModel'
import { performance } from 'node:perf_hooks'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import type { Page } from '@playwright/test'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { IpcResult } from '@shared/ipc/errors/IpcError'
import { saveNativeFile } from '../../../scripts/e2e/regression/systemAutomation'
import { selectVisibleModel } from './models'

test(...caseDefinition('MP-20'), async ({ mainWindow: page }, testInfo) => {
  // Mock only the provider HTTP boundary; topic creation, navigation and persistence use the real app.
  const server = await startMockChatServer()
  const providerId = `regression-mp20-${Date.now()}`
  const preferences = await page.evaluate(async () => ({
    model: await window.api.preference.get('chat.default_model_id'),
    naming: await window.api.preference.get('topic.naming.enabled'),
    shortcut: await window.api.preference.get('chat.input.send_message_shortcut')
  }))
  let topicId: string | undefined
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  try {
    const created = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: 'mp20-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-20 mock provider',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    expect(created.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp20-enable',
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
          id: 'mp20-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(models.status).toBe(201)
    await page.evaluate(
      (modelId) =>
        window.api.preference.setMultiple({
          'chat.default_model_id': modelId,
          'topic.naming.enabled': false,
          'chat.input.send_message_shortcut': ['Enter']
        }),
      createUniqueModelId(providerId, server.modelId)
    )
    await page.reload()
    await screenshot('MP-20 application before Home navigation')
    const composer = page.locator('[data-ui~="chat.composer"] [contenteditable="true"]:visible').first()

    const errors: string[] = []
    const onPageError = (error: Error) => errors.push(error.message)
    page.on('pageerror', onPageError)
    try {
      await page.evaluate(() => {
        const state = window as typeof window & { mp20Errors?: string[]; mp20Observer?: MutationObserver }
        state.mp20Errors = []
        state.mp20Observer = new MutationObserver(() => {
          for (const alert of document.querySelectorAll('[role="alert"]')) {
            if (alert.textContent) state.mp20Errors!.push(alert.textContent)
          }
        })
        state.mp20Observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      })
      await selectSidebarApp(page, 'Home')
      await expect(composer).toBeEditable()
      await screenshot('MP-20 Home composer')
      await composer.fill('hello')
      const started = performance.now()
      const requestPromise = server.nextRequest(5_000)
      await composer.press('Enter')
      const request = await requestPromise
      expect(request.body.model).toBe(server.modelId)
      expect(request.body.messages).toEqual(
        expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'hello' })])
      )
      expect(request.body.stream).toBe(true)
      request.sendText('Hello')
      const chat = page.locator('[data-ui~="chat.view"]:visible')
      const messages = chat.locator('[data-ui~="chat.message"][data-message-id]:visible')
      const assistant = messages.filter({ has: page.locator('.message-assistant') }).last()
      await expect(assistant.getByText('Hello', { exact: true })).toBeVisible({
        timeout: Math.max(1, 5_000 - (performance.now() - started))
      })
      const firstTextMs = performance.now() - started
      request.complete(' from MP-20.')
      expect(firstTextMs, 'First visible assistant text after pressing Enter').toBeLessThanOrEqual(5_000)
      await testInfo.attach('MP-20 first text timing (mock provider)', {
        body: JSON.stringify({ firstTextMs, limitMs: 5_000 }),
        contentType: 'application/json'
      })
      await expect(messages).toHaveCount(2)
      await expect(messages.getByText('hello', { exact: true })).toBeVisible()
      await expect(assistant.getByText('Hello from MP-20.', { exact: true })).toBeVisible()
      const messageId = await assistant.getAttribute('data-message-id')
      expect(messageId).toBeTruthy()
      const readMessage = () =>
        page.evaluate(
          (id) => window.api.dataApi.request({ id: 'mp20-read', method: 'GET', path: `/messages/${id}` }),
          messageId!
        )
      await expect.poll(async () => MessageSchema.parse((await readMessage()).data).status).toBe('success')
      topicId = MessageSchema.parse((await readMessage()).data).topicId
      const topic = await page.evaluate(
        (id) => window.api.dataApi.request({ id: 'mp20-topic', method: 'GET', path: `/topics/${id}` }),
        topicId
      )
      expect(topic.status).toBe(200)
      const name = TopicSchema.parse(topic.data).name
      expect(name).not.toBe('')
      await screenshot('MP-20 automatically created conversation')

      await selectSidebarApp(page, 'Home')
      await expect(composer).toBeEditable()
      await expect(page.getByText('Recent', { exact: true })).toBeVisible()
      const recentTopic = page.getByText(name, { exact: true }).filter({ visible: true })
      await expect(recentTopic).toHaveCount(1)
      await screenshot('MP-20 Home recent conversation')
      await recentTopic.click()
      await expect(chat).toBeVisible()
      await expect(messages).toHaveCount(2)
      await expect(messages.getByText('hello', { exact: true })).toBeVisible()
      await expect(assistant.getByText('Hello from MP-20.', { exact: true })).toBeVisible()
      await expect(assistant).toHaveAttribute('data-message-id', messageId!)
      await screenshot('MP-20 reopened conversation contents')
      expect(errors, 'No renderer exceptions during the complete workflow').toEqual([])
      expect(
        await page.evaluate(() => (window as typeof window & { mp20Errors?: string[] }).mp20Errors),
        'No error alerts during the complete workflow'
      ).toEqual([])
    } finally {
      page.off('pageerror', onPageError)
      await page.evaluate(() => {
        ;(window as typeof window & { mp20Observer?: MutationObserver }).mp20Observer?.disconnect()
      })
    }
  } finally {
    await server.close()
    await page.evaluate(
      async ({ providerId, topicId, preferences }) => {
        await window.api.preference.setMultiple({
          'chat.default_model_id': preferences.model,
          'topic.naming.enabled': preferences.naming,
          'chat.input.send_message_shortcut': preferences.shortcut
        })
        if (topicId) {
          await window.api.ipcApi.request('trash.topic.archive', { topicIds: [topicId] })
          await window.api.ipcApi.request('trash.topic.delete_permanently', { topicIds: [topicId] })
        }
        await window.api.dataApi.request({ id: 'mp20-delete', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { providerId, topicId, preferences }
    )
  }
})

test(...caseDefinition('MP-22'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const suffix = Date.now()
  const providerId = `mp22-${suffix}`
  const modelId = createUniqueModelId(providerId, 'mp22-fixture')
  const names = ['QA assistant', 'Second assistant', 'Third assistant'].map((name) =>
    app.resourceName(`${name} ${suffix}`)
  )
  const renamed = app.resourceName(`Edited assistant ${suffix}`)
  const prompt = 'QA MP-22: explain answers in exactly three numbered steps.'
  const temporaryName = app.resourceName(`Temporary assistant ${suffix}`)
  const historyName = app.resourceName(`Retained history ${suffix}`)
  const historyText = `MP-22 historical message ${suffix}`
  const assistantIds: string[] = []
  const topicIds: string[] = []
  let agentId: string | undefined
  const preferences = await page.evaluate(async () => ({
    menu: await window.api.preference.get('menu.presentation_mode'),
    mode: await window.api.preference.get('topic.tab.display_mode'),
    sort: await window.api.preference.get('assistant.tab.sort_type')
  }))
  const screenshot = async (name: string, target = page) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(target, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const headers = (target = page) =>
    target.locator(
      '[data-ui~="chat.view"]:visible [data-ui~="chat.group-header"]:not(:has([data-ui~="chat.group-header"]))'
    )
  const row = (name: string, target = page) => headers(target).filter({ hasText: name }).first()
  const menu = async (name: string, action: string, target = page) => {
    await row(name, target).click({ button: 'right' })
    await target.getByRole('menuitem', { name: action, exact: true }).click()
  }
  const archiveDialog = (target = page) =>
    target.getByRole('alertdialog').or(target.getByRole('dialog', { name: 'Archive', exact: true }))
  const openArchive = async (name: string, target = page) => {
    await menu(name, 'Archive', target)
    const dialog = archiveDialog(target)
    await expect(dialog).toBeVisible()
    return dialog
  }
  const readAssistant = async (id: string) => {
    const result = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'mp22-read', method: 'GET', path: `/assistants/${id}` }),
      id
    )
    expect(result.status).toBe(200)
    return AssistantSchema.parse(result.data)
  }
  const addTopic = async (assistantId: string, name: string) => {
    const result = await page.evaluate(
      ({ assistantId, name }) =>
        window.api.dataApi.request({ id: 'mp22-topic', method: 'POST', path: '/topics', body: { assistantId, name } }),
      { assistantId, name }
    )
    expect(result.status).toBe(201)
    const topic = TopicSchema.parse(result.data)
    topicIds.push(topic.id)
    return topic.id
  }

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'menu.presentation_mode': 'cherry',
        'topic.tab.display_mode': 'assistant',
        'assistant.tab.sort_type': 'list'
      })
    )
    // Local persisted fixtures only: no external model or canned model response is used.
    const provider = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp22-provider',
          method: 'POST',
          path: '/providers',
          body: { providerId, name: 'MP-22 fixture' }
        }),
      providerId
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp22-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const models = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp22-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId: 'mp22-fixture', endpointTypes: ['openai-chat-completions'] }]
        }),
      providerId
    )
    expect(models.status).toBe(201)
    for (const name of names) {
      const result = await page.evaluate(
        ({ name, modelId }) =>
          window.api.dataApi.request({
            id: 'mp22-assistant',
            method: 'POST',
            path: '/assistants',
            body: { name, modelId }
          }),
        { name, modelId }
      )
      expect(result.status).toBe(201)
      const assistant = AssistantSchema.parse(result.data)
      assistantIds.push(assistant.id)
      await addTopic(assistant.id, `${name} topic`)
    }
    const agent = await page.evaluate(
      ({ name, model }) => window.api.ipcApi.request('ai.agent.create', { name, model, type: 'pi' }),
      { name: app.resourceName(`Archive agent ${suffix}`), model: modelId }
    )
    const agentResult = agent as IpcResult<AgentEntity>
    if (!agentResult.ok) throw new Error(JSON.stringify(agentResult.error))
    agentId = agentResult.data.id
    const session = await page.evaluate(
      (agentId) =>
        window.api.dataApi.request({
          id: 'mp22-session',
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name: 'MP-22 archive session', workspace: { type: 'system' } }
        }),
      agentId
    )
    expect(session.status).toBe(201)
    for (const id of [...assistantIds].reverse()) {
      const ordered = await page.evaluate(
        (id) =>
          window.api.dataApi.request({
            id: 'mp22-initial-order',
            method: 'PATCH',
            path: `/assistants/${id}/order`,
            body: { position: 'first' }
          }),
        id
      )
      expect(ordered.status).toBe(200)
    }
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    await expect(headers().first()).toContainText(names[0])
    await expect(headers().nth(1)).toContainText(names[1])

    await test.step('Edit name and prompt through the assistant card', async () => {
      await menu(names[0], 'Edit Assistant')
      const editor = page.getByRole('dialog')
      await editor.getByRole('textbox', { name: 'Name', exact: true }).fill(renamed)
      await editor.getByRole('tab', { name: 'System Prompt', exact: true }).click()
      const editPrompt = editor.getByRole('button', { name: 'Edit', exact: true })
      if (await editPrompt.isVisible()) await editPrompt.click()
      await editor.locator('.cm-content[contenteditable="true"]').fill(prompt)
      await page.keyboard.press('Escape')
      await expect(editor).toBeHidden()
      await expect(row(renamed)).toBeVisible()
      await expect
        .poll(async () => {
          const saved = await readAssistant(assistantIds[0])
          return { name: saved.name, prompt: saved.prompt }
        })
        .toEqual({ name: renamed, prompt })
    })

    await test.step('Drag the second assistant above the first, then pin the third', async () => {
      const first = row(renamed)
      const second = row(names[1])
      await expect(second).toBeVisible()
      const target = await first.boundingBox()
      const source = await second.boundingBox()
      if (!target || !source) throw new Error('Assistant cards have no draggable layout')
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
      await page.mouse.down()
      await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, { steps: 5 })
      await page.mouse.move(target.x + target.width / 2, target.y + 2, { steps: 25 })
      await page.mouse.up()
      const order = async () =>
        (await headers().allTextContents())
          .filter((text) => [renamed, names[1]].some((name) => text.includes(name)))
          .map((text) => (text.includes(renamed) ? renamed : names[1]))
      await expect.poll(order).toEqual([names[1], renamed])
      await expect(headers().first()).toContainText(names[1])
      await menu(names[2], 'Pin Assistant')
      await expect(headers().first()).toContainText(names[2])
      await screenshot('MP-22 edited reordered and pinned assistants')
    })

    await test.step('Restart preserves assistant edits and dragged order', async () => {
      page = await app.restart()
      await selectSidebarApp(page, 'Chat')
      const saved = await readAssistant(assistantIds[0])
      expect(saved.name).toBe(renamed)
      expect(saved.prompt).toBe(prompt)
      await expect(headers().first()).toContainText(names[2])
      const reordered = (await headers().allTextContents()).filter(
        (text) => text.includes(renamed) || text.includes(names[1])
      )
      expect(reordered[0]).toContain(names[1])
      expect(reordered[1]).toContain(renamed)
      await menu(renamed, 'Edit Assistant')
      const editor = page.getByRole('dialog')
      await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(renamed)
      await editor.getByRole('tab', { name: 'System Prompt', exact: true }).click()
      const editPrompt = editor.getByRole('button', { name: 'Edit', exact: true })
      if (await editPrompt.isVisible()) await editPrompt.click()
      await expect(editor.locator('.cm-content[contenteditable="true"]')).toHaveText(prompt)
      await page.keyboard.press('Escape')
      await expect(editor).toBeHidden()
    })

    await test.step('Create and delete a temporary assistant while retaining its conversation', async () => {
      await page
        .locator('[data-ui~="chat.view"]:visible')
        .getByRole('button', { name: 'Add Assistant', exact: true })
        .click()
      await page.getByRole('option', { name: 'New Assistant', exact: true }).click()
      await page.getByPlaceholder('Enter a name', { exact: true }).fill(temporaryName)
      await page.locator('[aria-label="Model"]').click()
      await selectVisibleModel(page, 'mp22-fixture')
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      const listed = await page.evaluate(() =>
        window.api.dataApi.request({ id: 'mp22-list', method: 'GET', path: '/assistants' })
      )
      expect(listed.status).toBe(200)
      const temporary = (listed.data as { items: unknown[] }).items
        .map((item) => AssistantSchema.parse(item))
        .find((item) => item.name === temporaryName)
      expect(temporary).toBeDefined()
      assistantIds.push(temporary!.id)
      const topicId = await addTopic(temporary!.id, historyName)
      const message = await page.evaluate(
        ({ topicId, text }) =>
          window.api.dataApi.request({
            id: 'mp22-history',
            method: 'POST',
            path: `/topics/${topicId}/messages`,
            body: { role: 'user', data: { parts: [{ type: 'text', text }] } }
          }),
        { topicId, text: historyText }
      )
      expect(message.status).toBe(201)
      const originalMessage = MessageSchema.parse(message.data)
      await page.reload()
      await selectSidebarApp(page, 'Chat')
      const dialog = await openArchive(temporaryName)
      await dialog.getByRole('checkbox', { name: 'Also archive related topics', exact: true }).uncheck()
      await dialog.getByRole('button', { name: 'Archive', exact: true }).click()
      await expect(row(temporaryName)).toHaveCount(0)
      const unlinked = row('Unlinked Assistant')
      await expect(unlinked).toBeVisible()
      await unlinked.hover()
      const expand = unlinked.getByRole('button', { name: 'Expand', exact: true })
      if (await expand.isVisible()) await expand.click()
      await page.getByTestId('topic-list-row').filter({ hasText: historyName }).click()
      await expect(page.locator('[data-ui~="chat.message"]').filter({ hasText: historyText })).toBeVisible()
      const preserved = await page.evaluate(
        (id) => window.api.dataApi.request({ id: 'mp22-preserved', method: 'GET', path: `/messages/${id}` }),
        originalMessage.id
      )
      expect(preserved.status).toBe(200)
      expect(MessageSchema.parse(preserved.data).data).toEqual(originalMessage.data)
      await screenshot('MP-22 deleted assistant history in Unlinked Assistant')
    })

    await test.step('Remember assistant archive selection across dialogs and another window', async () => {
      const dialog = await openArchive(renamed)
      await dialog.getByRole('checkbox', { name: 'Also archive related topics', exact: true }).check()
      await screenshot('MP-22 assistant archive checked')
      await dialog.getByRole('button', { name: 'Archive', exact: true }).click()
      await expect(row(renamed)).toHaveCount(0)
      const next = await openArchive(names[1])
      await expect
        .soft(
          next.getByRole('checkbox', { name: 'Also archive related topics', exact: true }),
          'Assistant archive must remember the confirmed selection'
        )
        .toBeChecked({ timeout: 2000 })
      await screenshot('MP-22 next assistant archive remembered selection')
      await next.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.evaluate(
        ({ id, url }) =>
          window.api.ipcApi.request('tab.detach', { id, url, title: 'MP-22 second window', type: 'route' }),
        { id: `mp22-window-${suffix}`, url: '/app/chat' }
      )
      let other: Page | undefined
      await expect
        .poll(async () => {
          for (const candidate of page.context().pages()) {
            if (
              candidate.url().includes('/windows/subWindow/') &&
              (await candidate.locator('[data-ui~="chat.view"]:visible').isVisible())
            ) {
              other = candidate
              return true
            }
          }
          return false
        })
        .toBe(true)
      if (!other) throw new Error('Detached application window did not open')
      try {
        const showSidebar = other.getByRole('button', { name: 'Show Sidebar', exact: true })
        if (await showSidebar.isVisible()) await showSidebar.click()
        const crossWindow = await openArchive(names[1], other)
        await expect
          .soft(
            crossWindow.getByRole('checkbox', { name: 'Also archive related topics', exact: true }),
            'Assistant archive selection must sync to another window'
          )
          .toBeChecked({ timeout: 2000 })
        await screenshot('MP-22 archive selection in another window', other)
        await crossWindow.getByRole('button', { name: 'Cancel', exact: true }).click()
      } finally {
        await other.close()
      }
    })

    await test.step('Restart preserves edits, ordering, pinning and archive choice', async () => {
      page = await app.restart()
      await selectSidebarApp(page, 'Chat')
      await expect(headers().first()).toContainText(names[2])
      const remaining = (await headers().allTextContents()).filter(
        (text) => text.includes(names[1]) || text.includes(names[2])
      )
      expect(remaining[0]).toContain(names[2])
      expect(remaining[1]).toContain(names[1])
      const dialog = await openArchive(names[1])
      await expect
        .soft(
          dialog.getByRole('checkbox', { name: 'Also archive related topics', exact: true }),
          'Assistant archive selection must survive a complete restart'
        )
        .toBeChecked({ timeout: 2000 })
      await screenshot('MP-22 archive selection after restart')
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    })

    await test.step('Agent archive selection remains unchecked on every opening', async () => {
      await selectSidebarApp(page, 'Work')
      const agentRow = page
        .locator('[data-ui~="agent.view"]:visible')
        .locator(
          '[data-ui~="chat.group-header"]:not(:has([data-ui~="chat.group-header"])), [data-testid="resource-entity-rail-row"]'
        )
        .filter({ hasText: `Archive agent ${suffix}` })
        .first()
      for (let attempt = 0; attempt < 2; attempt++) {
        await agentRow.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
        const dialog = archiveDialog()
        const checkbox = dialog.getByRole('checkbox', { name: 'Also archive related sessions', exact: true })
        await expect(checkbox).not.toBeChecked()
        await checkbox.check()
        await screenshot(`MP-22 agent archive opening ${attempt + 1}`)
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      }
      await agentRow.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
      await expect(archiveDialog().getByRole('checkbox')).not.toBeChecked()
      await archiveDialog().getByRole('button', { name: 'Archive', exact: true }).click()
      await expect(agentRow).toHaveCount(0)
    })
  } finally {
    await page.keyboard.press('Escape').catch(() => undefined)
    await page.evaluate(
      async ({ assistantIds, topicIds, providerId, agentId, preferences }) => {
        for (const assistantId of assistantIds) {
          await window.api.ipcApi
            .request('trash.assistant.archive', { assistantId, deleteTopics: false })
            .catch(() => undefined)
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        for (const topicId of topicIds) {
          await window.api.ipcApi.request('trash.topic.archive', { topicIds: [topicId] }).catch(() => undefined)
          await window.api.ipcApi
            .request('trash.topic.delete_permanently', { topicIds: [topicId] })
            .catch(() => undefined)
        }
        if (agentId) {
          await window.api.ipcApi.request('ai.agent.delete', { agentId, deleteSessions: true }).catch(() => undefined)
          await window.api.ipcApi.request('ai.agent.delete_permanently', { agentId, deleteSessions: true })
        }
        await window.api.dataApi.request({
          id: 'mp22-cleanup-provider',
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
        await window.api.preference.setMultiple({
          'menu.presentation_mode': preferences.menu,
          'topic.tab.display_mode': preferences.mode,
          'assistant.tab.sort_type': preferences.sort
        })
      },
      { assistantIds, topicIds, providerId, agentId, preferences }
    )
  }
})

test(...caseDefinition('MP-23'), async ({ app, mainWindow: page }, testInfo) => {
  const name = app.resourceName(`Export import ${Date.now()}`)
  const prompt = 'MP-23: 请保留此提示词。Answer with three numbered steps.\nPreserve Unicode and newlines.'
  const emoji = '🦊'
  const providerId = `mp23-${Date.now()}`
  const modelId = createUniqueModelId(providerId, 'mp23-fixture')
  const exportedPath = join(app.paths.evidence, 'MP-23-assistant.json')
  const originalDefault = await page.evaluate(() => window.api.preference.get('chat.default_model_id'))
  const screenshot = async (label: string) => {
    const path = testInfo.outputPath(`${label}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(label, { path, contentType: 'image/png' })
  }
  const readAssistants = async () => {
    const result = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'mp23-list', method: 'GET', path: '/assistants' })
    )
    expect(result.status).toBe(200)
    return (result.data as { items: unknown[] }).items
      .map((item) => AssistantSchema.parse(item))
      .filter((item) => item.name.startsWith(name))
  }
  try {
    // Persisted local fixtures only; export/import does not require model inference.
    const provider = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp23-provider',
          method: 'POST',
          path: '/providers',
          body: { providerId, name: 'MP-23 fixture' }
        }),
      providerId
    )
    expect(provider.status).toBe(201)
    const model = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp23-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId: 'mp23-fixture', endpointTypes: ['openai-chat-completions'] }]
        }),
      providerId
    )
    expect(model.status).toBe(201)
    await page.evaluate((modelId) => window.api.preference.set('chat.default_model_id', modelId), modelId)
    const created = await page.evaluate(
      ({ name, prompt, emoji, modelId }) =>
        window.api.dataApi.request({
          id: 'mp23-create',
          method: 'POST',
          path: '/assistants',
          body: { name, prompt, emoji, modelId }
        }),
      { name, prompt, emoji, modelId }
    )
    expect(created.status).toBe(201)
    const original = AssistantSchema.parse(created.data)
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    await page.getByRole('button', { name: 'Display mode', exact: true }).click()
    await page.getByText('Manage Assistants', { exact: true }).click()
    const cards = page
      .getByRole('button', { name, exact: true })
      .filter({ has: page.getByRole('heading', { name, exact: true }) })
    await expect(cards).toHaveCount(1)
    await screenshot('MP-23 custom assistant before export')
    await cards.first().getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export Assistant', exact: true }).click()
    if (app.record.platform === 'macos') {
      // Keep the JSON extension: the generic save helper strips it from the native filename.
      execFileSync(
        'osascript',
        [
          '-e',
          [
            'on run argv',
            'tell application "System Events"',
            'set frontmost of first application process whose unix id is (item 3 of argv as integer) to true',
            'delay 2',
            'keystroke "g" using {command down, shift down}',
            'delay 1',
            'keystroke (item 1 of argv)',
            'key code 36',
            'delay 1',
            'keystroke "a" using command down',
            'keystroke (item 2 of argv)',
            'key code 36',
            'end tell',
            'end run'
          ].join('\n'),
          '--',
          dirname(exportedPath),
          basename(exportedPath),
          String(app.record.electronPid)
        ],
        { timeout: 15000 }
      )
    } else {
      saveNativeFile(app.record.platform, app.paths, exportedPath)
    }
    await expect.poll(() => readFile(exportedPath, 'utf8').catch(() => '')).not.toBe('')
    const content = await readFile(exportedPath, 'utf8')
    const exported = JSON.parse(content)
    expect(exported).toEqual([expect.objectContaining({ name, prompt, emoji, description: '', type: 'agent' })])
    expect(exported[0].group).toEqual([])
    expect(exported[0].regularPhrases).toEqual([])
    await testInfo.attach('MP-23 exported JSON', { path: exportedPath, contentType: 'application/json' })
    if (app.record.platform === 'macos') {
      const editorText = execFileSync(
        'osascript',
        [
          '-e',
          [
            'on run argv',
            'tell application "TextEdit"',
            'set exportedDocument to open POSIX file (item 1 of argv)',
            'set exportedText to text of exportedDocument',
            'close exportedDocument saving no',
            'return exportedText',
            'end tell',
            'end run'
          ].join('\n'),
          '--',
          exportedPath
        ],
        { encoding: 'utf8', timeout: 15000 }
      )
      expect(JSON.parse(editorText)).toEqual(exported)
    }
    await screenshot('MP-23 original assistant after JSON export')

    await page.getByRole('button', { name: 'Import Assistant', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await dialog.locator('input[type="file"]').setInputFiles(exportedPath)
    await expect(dialog).toContainText('Imported successfully: MP-23-assistant.json')
    const afterImport = await readAssistants()
    expect(afterImport).toHaveLength(2)
    expect(afterImport.find(({ id }) => id === original.id)).toEqual(original)
    const imported = afterImport.find(({ id }) => id !== original.id)!
    expect(imported).toMatchObject({ name, prompt, emoji })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(cards).toHaveCount(2)
    for (const card of await cards.all()) await expect(card).toContainText(emoji)
    await cards.nth(1).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('tab', { name: 'System Prompt', exact: true }).click()
    const edit = dialog.getByRole('button', { name: 'Edit', exact: true })
    if (await edit.isVisible()) await edit.click()
    await expect(dialog.locator('.cm-content[contenteditable="true"]')).toHaveText(prompt, { useInnerText: true })
    await screenshot('MP-23 imported assistant prompt and icon')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await page.getByRole('button', { name: 'Import Assistant', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.locator('input[type="file"]').setInputFiles(exportedPath)
    await expect(dialog).toContainText(/Imported successfully|already exists|overwrite|replace|rename|name conflict/i)
    await screenshot('MP-23 repeated same-name import handling')
    const afterRepeat = await readAssistants()
    expect(afterRepeat.find(({ id }) => id === original.id)).toEqual(original)
    expect(afterRepeat.find(({ id }) => id === imported.id)).toEqual(imported)
    await expect(dialog, 'MP-23: same-name import must explicitly offer overwrite or rename handling').toContainText(
      /already exists|overwrite|replace|rename|name conflict/i,
      { timeout: 3000 }
    )
  } finally {
    await page.keyboard.press('Escape').catch(() => undefined)
    const assistants = await readAssistants()
    await page.evaluate(
      async ({ ids, providerId, originalDefault }) => {
        for (const assistantId of ids) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        await window.api.preference.set('chat.default_model_id', originalDefault)
        await window.api.dataApi.request({ id: 'mp23-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { ids: assistants.map(({ id }) => id), providerId, originalDefault }
    )
  }
})

test(...caseDefinition('MP-24'), async ({ app, mainWindow }, testInfo) => {
  await assistantGroupManagement(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-25'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const server = await startMockChatServer()
  const providerId = `regression-move-${Date.now()}`
  const assistantIds: string[] = []
  const names = [app.resourceName('Move source A'), app.resourceName('Move destination B')]
  const topicName = app.resourceName('Conversation to move')
  const prompt = 'MP-25 remember the blue lighthouse.'
  const answer = 'MP-25 the blue lighthouse is remembered.'
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode')
  }))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const chat = () => page.locator('[data-ui~="chat.view"]:visible')
  const row = (name: string) =>
    chat()
      .getByTestId('topic-list-row')
      .filter({ has: page.getByText(name, { exact: true }) })
  const messages = () => chat().locator('[data-ui~="chat.message"][data-message-id]:visible')
  const expand = async (name: string, expanded: boolean) => {
    const header = chat().locator('[data-ui~="chat.group-header"]').filter({ hasText: name }).first()
    await expect(header).toBeVisible()
    await header.hover()
    const button = header.getByRole('button', { name: expanded ? 'Expand' : 'Collapse', exact: true })
    if (await button.isVisible()) await button.click()
  }

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'topic.naming.enabled': false,
        'menu.presentation_mode': 'cherry'
      })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: 'mp25-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-25 mock provider',
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
          id: 'mp25-enable',
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
          id: 'mp25-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(models.status).toBe(201)
    for (const name of names) {
      const assistant = await page.evaluate(
        ({ name, modelId }) =>
          window.api.dataApi.request({
            id: 'mp25-assistant',
            method: 'POST',
            path: '/assistants',
            body: { name, modelId }
          }),
        { name, modelId: createUniqueModelId(providerId, server.modelId) }
      )
      expect(assistant.status).toBe(201)
      assistantIds.push(AssistantSchema.parse(assistant.data).id)
    }
    const createTopic = async (name: string, assistantId: string) => {
      const response = await page.evaluate(
        ({ name, assistantId }) =>
          window.api.dataApi.request({
            id: 'mp25-topic',
            method: 'POST',
            path: '/topics',
            body: { name, assistantId }
          }),
        { name, assistantId }
      )
      expect(response.status).toBe(201)
      return TopicSchema.parse(response.data)
    }
    const topic = await createTopic(topicName, assistantIds[0])
    const anchors = await Promise.all(assistantIds.map((id, index) => createTopic(`${names[index]} anchor`, id)))
    const readTopic = async () => {
      const response = await page.evaluate(
        (id) =>
          window.api.dataApi.request({
            id: 'mp25-read-topic',
            method: 'GET',
            path: `/topics/${id}`
          }),
        topic.id
      )
      expect(response.status).toBe(200)
      return TopicSchema.parse(response.data)
    }
    const readMessages = async () => {
      const response = await page.evaluate(
        (id) =>
          window.api.dataApi.request({
            id: 'mp25-read-messages',
            method: 'GET',
            path: `/topics/${id}/messages`
          }),
        topic.id
      )
      expect(response.status).toBe(200)
      const branch = response.data as BranchMessagesResponse
      expect(branch.nextCursor).toBeUndefined()
      return {
        assistantId: branch.assistantId,
        messages: branch.items.map(({ message }) => MessageSchema.parse(message))
      }
    }
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    await expand(names[0], true)
    await row(topicName).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    // Mock only the provider response; moving, message persistence and restarting use the real application.
    await Promise.all([
      sendChatMarker(page, prompt, answer),
      (async () => {
        const request = await server.nextRequest()
        expect(request.body.model).toBe(server.modelId)
        expect(request.body.messages).toEqual(expect.arrayContaining([{ role: 'user', content: prompt }]))
        request.complete(answer)
      })()
    ])
    const original = await readMessages()
    expect(original.assistantId).toBe(assistantIds[0])
    expect(original.messages.map(({ role }) => role)).toEqual(['user', 'assistant'])
    expect(
      original.messages.map(({ data }) =>
        (data.parts ?? [])
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('')
      )
    ).toEqual([prompt, answer])
    for (const message of original.messages) {
      expect(message.topicId).toBe(topic.id)
      expect(Number.isFinite(Date.parse(message.createdAt))).toBe(true)
      expect(Number.isFinite(Date.parse(message.updatedAt))).toBe(true)
    }
    const unlinkedHeaders = () =>
      chat()
        .locator('[data-ui~="chat.group-header"]')
        .filter({ has: page.getByText('Unlinked Assistant', { exact: true }) })
    const initialUnlinkedCount = await unlinkedHeaders().count()
    await row(topicName).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to', exact: true }).hover()
    await page
      .getByRole('menu', { name: 'Move to', exact: true })
      .getByRole('menuitem')
      .filter({ has: page.getByText(names[1], { exact: true }) })
      .click()
    await expect.poll(async () => (await readTopic()).assistantId).toBe(assistantIds[1])

    const assertMoved = async () => {
      await expand(names[1], false)
      await expand(names[0], true)
      await expect(row(anchors[0].name)).toBeVisible()
      await expect(row(topicName)).toHaveCount(0)
      await row(anchors[0].name).click()
      await expect(messages()).toHaveCount(0)
      await expand(names[1], true)
      await expect(row(anchors[1].name)).toBeVisible()
      await expect(row(topicName)).toHaveCount(1)
      await row(topicName).click()
      await expect(messages()).toHaveCount(2)
      await expect(messages().nth(0).getByText(prompt, { exact: true })).toBeVisible()
      await expect(messages().nth(1).getByText(answer, { exact: true })).toBeVisible()
      expect(await readMessages()).toEqual({ assistantId: assistantIds[1], messages: original.messages })
      expect(await readTopic()).toMatchObject({ id: topic.id, name: topicName, assistantId: assistantIds[1] })
      await expect(unlinkedHeaders()).toHaveCount(initialUnlinkedCount)
    }
    await assertMoved()
    await screenshot('MP-25 moved conversation in B (mock provider)')
    const before = app.record
    page = await app.restart()
    expect(app.record.electronPid).not.toBe(before.electronPid)
    expect(app.record.restartCount).toBe(before.restartCount + 1)
    expect(app.record.profile).toBe(before.profile)
    await selectSidebarApp(page, 'Chat')
    await assertMoved()
    await screenshot('MP-25 ownership and intact messages after complete restart')
  } finally {
    await server.close()
    page = await app.mainWindow()
    await page.evaluate(
      async ({ assistantIds, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode
        })
        for (const assistantId of assistantIds) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        await window.api.dataApi.request({ id: 'mp25-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { assistantIds, providerId, preferences }
    )
  }
})

test(...caseDefinition('MP-26'), async ({ app, mainWindow }, testInfo) => {
  await switchConversationModel(app, mainWindow, testInfo)
})
