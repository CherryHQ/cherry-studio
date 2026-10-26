import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { type BranchMessagesResponse, MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { sendChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function clearChatMessages(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
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
  const providerId = `regression-clear-${Date.now()}`
  const topicName = app.resourceName('Clear messages')
  const assistantName = app.resourceName('Clear messages assistant')
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
            name: 'Clear messages mock',
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
          id: 'clear-messages-assistant',
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
          id: 'clear-messages-topic',
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
            id: 'clear-messages-read',
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
    const history = [
      { prompt: 'Remember my secret code: MP42-ORCHID-731.', answer: 'Your secret code is MP42-ORCHID-731.' },
      { prompt: 'What code did I give you?', answer: 'You gave me MP42-ORCHID-731.' }
    ]
    for (const [index, turn] of history.entries()) {
      await Promise.all([
        sendChatMarker(page, turn.prompt, turn.answer),
        (async () => {
          const request = await server.nextRequest()
          expect(request.body.model).toBe(server.modelId)
          expect(request.body.messages).toEqual(
            expect.arrayContaining([expect.objectContaining({ role: 'user', content: turn.prompt })])
          )
          if (index > 0) {
            expect(request.body.messages).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ role: 'user', content: history[0].prompt }),
                expect.objectContaining({ role: 'assistant', content: history[0].answer })
              ])
            )
          }
          request.complete(turn.answer)
        })()
      ])
    }
    await expect(messages).toHaveCount(4)
    const originalMessages = await readMessages()
    expect(originalMessages.map(({ role }) => role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    const originalIds = originalMessages.map(({ id }) => id)

    const dialog = page.getByRole('dialog', { name: 'Clear all messages?', exact: true })
    await topicRow.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Clear Messages', exact: true }).click()
    await expect(dialog).toBeVisible()
    expect((await readMessages()).map(({ id }) => id)).toEqual(originalIds)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(messages).toHaveCount(4)
    expect((await readMessages()).map(({ id }) => id)).toEqual(originalIds)

    await topicRow.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Clear Messages', exact: true }).click()
    await expect(dialog).toBeVisible()
    await attachScreenshot('MP-42 clear messages confirmation dialog')
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(messages).toHaveCount(0)
    await expect(chat.getByRole('heading', { name: 'What should we talk about today?', exact: true })).toBeVisible()
    await expect(chat.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()).toBeEditable()
    await expect(topicRow.getByText(topicName, { exact: true })).toBeVisible()
    await expect.poll(readMessages).toEqual([])
    for (const { id } of originalMessages) {
      const removed = await page.evaluate(
        (id) => window.api.dataApi.request({ id: 'clear-messages-deleted', method: 'GET', path: `/messages/${id}` }),
        id
      )
      expect(removed.status).toBe(404)
    }
    await attachScreenshot('MP-42 empty conversation after clearing')

    const followup = 'What was my secret code?'
    const answer = 'No secret code was provided in this conversation.'
    const [newMessageId] = await Promise.all([
      sendChatMarker(page, followup, answer),
      (async () => {
        const request = await server.nextRequest()
        expect(request.body.model).toBe(server.modelId)
        // Inspect the real provider input: a canned reply alone cannot prove that history was cleared.
        expect(request.body.messages.filter((message) => (message as { role: string }).role !== 'system')).toEqual([
          { role: 'user', content: followup }
        ])
        expect(JSON.stringify(request.body.messages)).not.toContain('MP42-ORCHID-731')
        request.complete(answer)
      })()
    ])
    await expect(messages).toHaveCount(2)
    await expect(chat.getByRole('heading', { name: 'What should we talk about today?', exact: true })).toBeHidden()
    await expect(topicRow.getByText(topicName, { exact: true })).toBeVisible()
    const remaining = await readMessages()
    expect(remaining.map(({ role }) => role)).toEqual(['user', 'assistant'])
    expect(remaining[1].id).toBe(newMessageId)
    expect(remaining.every((message) => message.topicId === topicId)).toBe(true)
    // TODO(MP-42): Direct SQLite counts/orphan checks need a run-owned DB reader; E2E helpers expose only DataApi.
    // These API checks count content messages; the database intentionally retains a content-less virtual root.
    await attachScreenshot('MP-42 conversation after post-clear message')
  } finally {
    await server.close()
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode
        })
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
      { assistantId, providerId, preferences }
    )
  }
}
