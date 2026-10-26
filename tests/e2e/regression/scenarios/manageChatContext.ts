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
import { sendChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function manageChatContext(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
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
  const providerId = `regression-context-${Date.now()}`
  const topicName = app.resourceName('Context management')
  const assistantName = app.resourceName('Context management assistant')
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
            name: 'Context management mock',
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
          body: [{ providerId, modelId, contextWindow: 32768, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'context-management-assistant',
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
          id: 'context-management-topic',
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
            id: 'context-management-read',
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
    const editor = chat.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
    // Mock only the provider; verify the context actually sent by the application.
    const secret = 'MP30-ORCHID-731'
    const history = Array.from({ length: 8 }, (_, index) => ({
      prompt: `Turn ${index}: Remember ${secret}. ` + 'We are planning a garden with orchids and roses. '.repeat(35),
      answer: `Garden plan ${index}: ` + 'Plant orchids in shade and water the roses every morning. '.repeat(35)
    }))
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
    const originalMessages = await readMessages()
    expect(originalMessages).toHaveLength(16)
    const originalIds = originalMessages.map(({ id }) => id)
    await attachScreenshot('MP-30 long conversation before context commands')
    const runCommand = async (command: string) => {
      await expect(editor).toBeEditable()
      await editor.fill(command)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
    }
    const assertOriginalHistory = async () => {
      const stored = await readMessages()
      expect(stored.slice(0, originalIds.length).map(({ id }) => id)).toEqual(originalIds)
      for (const original of originalMessages) {
        expect(stored.find(({ id }) => id === original.id)?.data.parts).toEqual(original.data.parts)
      }
    }
    // Chat keeps the whole conversation in context, so the last turn must still carry the first one.
    const lastPrompt = 'Continue the garden plan with a watering schedule.'
    const lastAnswer = 'Water the roses every morning and the orchids twice a week.'
    await Promise.all([
      sendChatMarker(page, lastPrompt, lastAnswer),
      (async () => {
        const request = await server.nextRequest()
        const sent = JSON.stringify(request.body.messages)
        for (const turn of history) {
          expect(sent).toContain(turn.prompt)
          expect(sent).toContain(turn.answer)
        }
        expect(sent).toContain(lastPrompt)
        request.complete(lastAnswer)
      })()
    ])
    await expect(chat.getByText(lastAnswer, { exact: true })).toBeVisible()
    await assertOriginalHistory()
    const remaining = await readMessages()
    expect(remaining.filter(({ status }) => status === 'error')).toEqual([])
    await attachScreenshot('MP-30 earlier turns retained in context')

    // Slash commands are an agent-session surface; Chat delivers the text as an ordinary user message.
    await runCommand('/context')
    const slashRequest = await server.nextRequest()
    expect(
      (slashRequest.body.messages as Array<{ role: string; content: unknown }>)
        .filter((message) => message.role === 'user')
        .at(-1),
      'Chat must deliver a slash command as ordinary text instead of opening a context dialog'
    ).toEqual({ role: 'user', content: '/context' })
    slashRequest.complete('Slash command received as chat text.')
    await expect(chat.getByText('Slash command received as chat text.', { exact: true })).toBeVisible()
    await expect(editor).toBeEditable()
    await attachScreenshot('MP-30 slash command delivered as chat text')
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
