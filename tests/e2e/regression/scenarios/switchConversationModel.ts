import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { type BranchMessagesResponse, MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { selectChatModel, sendChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function switchConversationModel(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode')
  }))
  const server = await startMockChatServer()
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const nextModelId = 'mock-chat-alternate'
  const providerId = `regression-switch-${Date.now()}`
  const topicName = app.resourceName('Switch model')
  const assistantName = app.resourceName('Switch model assistant')
  let assistantId: string | undefined

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({ 'topic.naming.enabled': false, 'menu.presentation_mode': 'cherry' })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Switch model mock',
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
      ({ providerId, modelId, nextModelId }) =>
        window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [modelId, nextModelId].map((id) => ({
            providerId,
            modelId: id,
            endpointTypes: ['openai-chat-completions']
          }))
        }),
      { providerId, modelId: server.modelId, nextModelId }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'switch-model-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'switch-model-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    const topicId = TopicSchema.parse(topic.data).id

    const readMessages = async () => {
      const response = await page.evaluate(
        (topicId) =>
          window.api.dataApi.request({
            id: 'switch-model-read',
            method: 'GET',
            path: `/topics/${topicId}/messages`
          }),
        topicId
      )
      expect(response.status).toBe(200)
      const branch = response.data as BranchMessagesResponse
      expect(branch.nextCursor).toBeUndefined()
      return branch.items.map(({ message }) => MessageSchema.parse(message))
    }

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    await expect(chat).toBeVisible({ timeout: 30_000 })
    const assistantRow = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(assistantRow).toBeVisible({ timeout: 30_000 })
    await assistantRow.hover()
    const expandButton = assistantRow.getByRole('button', { name: 'Expand', exact: true })
    if (await expandButton.isVisible().catch(() => false)) await expandButton.click()
    const topicRow = chat.getByTestId('topic-list-row').filter({ hasText: topicName })
    await expect(topicRow).toBeVisible({ timeout: 30_000 })
    await topicRow.click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    const messages = chat.locator('[data-ui~="chat.message"][data-message-id]:visible')
    const history = [{ prompt: 'Remember code MP26-ORCHID-731.', answer: 'I will remember MP26-ORCHID-731.' }]
    for (const turn of history) {
      await Promise.all([
        sendChatMarker(page, turn.prompt, turn.answer),
        (async () => {
          const request = await server.nextRequest()
          expect(request.body.model).toBe(server.modelId)
          expect(request.body.messages).toEqual(
            expect.arrayContaining([expect.objectContaining({ role: 'user', content: turn.prompt })])
          )
          request.complete(turn.answer)
        })()
      ])
    }
    await expect(messages).toHaveCount(2)
    const originalMessages = await readMessages()
    expect(originalMessages.map(({ role }) => role)).toEqual(['user', 'assistant'])

    const originalModelId = createUniqueModelId(providerId, server.modelId)
    const switchedModelId = createUniqueModelId(providerId, nextModelId)
    expect(originalMessages[1]).toMatchObject({ modelId: originalModelId, status: 'success' })
    await attachScreenshot('MP-26 existing conversation before switching (mock provider)')

    // Reopen an existing topic before using the same model control as a user.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    await expect(messages).toHaveCount(2)
    expect(await readMessages()).toEqual(originalMessages)
    // The context-impact confirmation belongs to Agent sessions (AgentChat). Chat applies the
    // selection to the open topic directly, so no dialog may block this control here.
    const dialog = page.getByRole('dialog', { name: `Switch to "${nextModelId}"?`, exact: true })

    const sendAndCheckModel = async (modelId: string, prompt: string, answer: string) => {
      const [id] = await Promise.all([
        sendChatMarker(page, prompt, answer),
        (async () => {
          const request = await server.nextRequest()
          expect(request.body.model).toBe(modelId)
          expect(request.body.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ role: 'user', content: prompt }),
              expect.objectContaining({ role: 'user', content: history[0].prompt }),
              expect.objectContaining({ role: 'assistant', content: history[0].answer })
            ])
          )
          request.complete(answer)
        })()
      ])
      return id
    }
    await sendAndCheckModel(server.modelId, 'Repeat the code after cancelling.', 'Still MP26-ORCHID-731.')
    const beforeSwitch = await readMessages()
    expect(beforeSwitch).toHaveLength(4)
    expect(beforeSwitch.slice(0, 2)).toEqual(originalMessages)
    expect(beforeSwitch[3]).toMatchObject({ modelId: originalModelId, status: 'success' })

    // Chat applies a model switch to the current topic immediately. The context-impact
    // confirmation is an Agent-session contract (AgentChat), so no dialog may block Chat here.
    await selectChatModel(page, nextModelId)
    await expect(dialog, 'Chat must apply a model switch without an Agent-session confirmation').toBeHidden({
      timeout: 3000
    })
    await attachScreenshot('MP-26 existing conversation after switching model')
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(nextModelId)
    expect(await readMessages()).toEqual(beforeSwitch)
    const replyId = await sendAndCheckModel(
      nextModelId,
      'Repeat the code with the new model.',
      'New model remembers MP26-ORCHID-731.'
    )
    await expect(messages).toHaveCount(6)
    const afterSwitch = await readMessages()
    expect(afterSwitch).toHaveLength(6)
    expect(afterSwitch.slice(0, 4)).toEqual(beforeSwitch)
    expect(afterSwitch[5]).toMatchObject({ id: replyId, modelId: switchedModelId, status: 'success' })
    expect(afterSwitch[5].messageSnapshot?.model).toMatchObject({
      id: nextModelId,
      name: nextModelId,
      provider: providerId
    })

    const reply = page.locator(`[data-ui~="chat.message"][data-message-id="${replyId}"]:visible`)
    await reply.hover()
    const detailsTrigger = reply.locator('button.message-tokens')
    await detailsTrigger.hover()
    await expect(detailsTrigger).toHaveAttribute('aria-describedby', /\S+/)
    const detailsId = await detailsTrigger.getAttribute('aria-describedby')
    expect(detailsId, 'Reply token details must open and identify the producing model').toBeTruthy()
    const details = page.locator(`[id="${detailsId}"]`)
    await expect(details.getByText(nextModelId, { exact: true })).toBeVisible()
    await expect(details.getByText('Switch model mock', { exact: true })).toBeVisible()
    await attachScreenshot('MP-26 new reply details match the actual mock request model')
  } finally {
    await server.close()
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode
        })
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        await window.api.dataApi.request({
          id: `${providerId}-delete`,
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
      },
      { assistantId, providerId, preferences }
    )
  }
}
