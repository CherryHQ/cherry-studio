import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { type BranchMessagesResponse, MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { sendChatMarker } from './chat'
import { selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'

export async function messageBranches(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode'),
    quickModel: await window.api.preference.get('feature.quick_assistant.model_id')
  }))
  const server = await startMockChatServer()
  const providerId = `regression-branches-${Date.now()}`
  const topicName = app.resourceName('Message branches')
  const assistantName = app.resourceName('Message branches assistant')
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
            name: 'Message branches mock',
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
          id: 'message-branches-assistant',
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
          id: 'message-branches-topic',
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
            id: 'message-branches-read',
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
    const topicRow = chat
      .getByTestId('topic-list-row')
      .filter({ has: page.getByText(topicName, { exact: true }) })
      .last()
    await expect(topicRow).toBeVisible({ timeout: 30_000 })
    await topicRow.click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    const messages = chat.locator('[data-ui~="chat.message"][data-message-id]:visible')
    // The mock supplies distinct replies; branching, copying, and naming use the real application.
    testInfo.annotations.push({ type: 'model-source', description: 'Local OpenAI-compatible mock' })
    const first = { prompt: 'Choose the orchid route.', answer: 'The orchid route follows the river.' }
    const second = { prompt: 'Choose the cedar route.', answer: 'The cedar route crosses the mountain.' }
    const reply = async (prompt: string, answer: string) => {
      const request = await server.nextRequest()
      expect(request.body.model).toBe(server.modelId)
      expect(request.body.messages.filter((message) => (message as { role: string }).role !== 'system')).toEqual([
        { role: 'user', content: prompt }
      ])
      request.complete(answer)
    }
    await Promise.all([sendChatMarker(page, first.prompt, first.answer), reply(first.prompt, first.answer)])
    const originalMessages = await readMessages()
    expect(originalMessages.map(({ role }) => role)).toEqual(['user', 'assistant'])
    const userMessage = () => messages.filter({ has: page.locator('.message-user') }).first()
    await userMessage().hover()
    await userMessage().getByRole('button', { name: 'Edit', exact: true }).click()
    await Promise.all([sendChatMarker(page, second.prompt, second.answer), reply(second.prompt, second.answer)])
    const editedMessages = await readMessages()
    expect(editedMessages.map(({ role }) => role)).toEqual(['user', 'assistant'])
    expect(editedMessages.every(({ id }) => !originalMessages.some((message) => message.id === id))).toBe(true)
    const verifyBranch = async (turn: typeof first, counter: string, expectedIds: string[]) => {
      await expect(messages).toHaveCount(2)
      await expect(messages.getByText(turn.prompt, { exact: true })).toBeVisible()
      await expect(messages.getByText(turn.answer, { exact: true })).toBeVisible()
      await expect(userMessage().getByText(counter, { exact: true })).toBeVisible()
      expect((await readMessages()).map(({ id }) => id)).toEqual(expectedIds)
    }
    const firstIds = originalMessages.map(({ id }) => id)
    const secondIds = editedMessages.map(({ id }) => id)
    await verifyBranch(second, '2/2', secondIds)
    await userMessage().getByRole('button', { name: 'Previous', exact: true }).click()
    await verifyBranch(first, '1/2', firstIds)
    await expect(messages.getByText(second.answer, { exact: true })).toBeHidden()
    await attachScreenshot('MP-29 first branch preserved at 1 of 2')
    await userMessage().getByRole('button', { name: 'Next', exact: true }).click()
    await verifyBranch(second, '2/2', secondIds)
    await expect(messages.getByText(first.answer, { exact: true })).toBeHidden()

    await page.getByRole('button', { name: 'Branch Management', exact: true }).click()
    const branchNode = page.locator(`.react-flow__node [data-message-id="${secondIds[1]}"]`)
    await expect(branchNode).toBeVisible()
    await attachScreenshot('MP-29 two independent branches in management')
    await branchNode.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Copy as New Conversation', exact: true }).click()
    await expect(page.getByText('Copied to a new conversation', { exact: true })).toBeVisible()
    const rows = chat.getByTestId('topic-list-row')
    await expect(rows).toHaveCount(2)
    const copiedRow = rows.first()
    await expect(copiedRow).toHaveCount(1)
    await copiedRow.click()
    await expect(messages).toHaveCount(2)
    await expect(messages.getByText(second.prompt, { exact: true })).toBeVisible()
    await expect(messages.getByText(second.answer, { exact: true })).toBeVisible()
    const copiedIds = await messages.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-message-id'))
    )
    expect(copiedIds.every((id) => !secondIds.includes(id!))).toBe(true)
    const copiedResponse = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'mp29-copy-read', method: 'GET', path: `/messages/${id}` }),
      copiedIds[0]!
    )
    expect(copiedResponse.status).toBe(200)
    const copiedTopicId = MessageSchema.parse(copiedResponse.data).topicId
    expect(copiedTopicId).not.toBe(topicId)
    const copied = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'mp29-copied-messages', method: 'GET', path: `/topics/${id}/messages` }),
      copiedTopicId
    )
    expect(copied.status).toBe(200)
    const copiedMessages = (copied.data as BranchMessagesResponse).items.map(({ message }) =>
      MessageSchema.parse(message)
    )
    expect(copiedMessages.map(({ role, data }) => ({ role, parts: data?.parts }))).toEqual(
      editedMessages.map(({ role, data }) => ({ role, parts: data?.parts }))
    )
    await page.evaluate(
      (modelId) => window.api.preference.set('feature.quick_assistant.model_id', modelId),
      createUniqueModelId(providerId, server.modelId)
    )
    await copiedRow.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Generate conversation name', exact: true }).click()
    const namingRequest = await server.nextRequest()
    expect(JSON.stringify(namingRequest.body.messages)).toContain(second.prompt)
    expect(JSON.stringify(namingRequest.body.messages)).toContain(second.answer)
    const generatedName = 'Cedar mountain journey'
    namingRequest.complete(generatedName)
    const namedRow = rows.filter({ hasText: generatedName })
    await expect(namedRow.getByText(generatedName, { exact: true })).toBeVisible()
    const namedTopic = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'mp29-name-read', method: 'GET', path: `/topics/${id}` }),
      copiedTopicId
    )
    expect(namedTopic.status).toBe(200)
    expect(TopicSchema.parse(namedTopic.data).name).toBe(generatedName)
    await attachScreenshot('MP-29 copied conversation with generated title and full messages')

    await rows.filter({ has: page.getByText(topicName, { exact: true }) }).click()
    await verifyBranch(second, '2/2', secondIds)
    await userMessage().getByRole('button', { name: 'Previous', exact: true }).click()
    await verifyBranch(first, '1/2', firstIds)
    for (const original of [...originalMessages, ...editedMessages]) {
      const response = await page.evaluate(
        (id) => window.api.dataApi.request({ id: 'mp29-original-read', method: 'GET', path: `/messages/${id}` }),
        original.id
      )
      expect(response.status).toBe(200)
      expect(MessageSchema.parse(response.data)).toMatchObject({
        id: original.id,
        topicId,
        role: original.role,
        data: original.data
      })
    }
    await expect(topicRow.getByText(topicName, { exact: true })).toBeVisible()
    await expect(namedRow.getByText(generatedName, { exact: true })).toBeVisible()
    await attachScreenshot('MP-29 original topic retains both branches after copy')
  } finally {
    await server.close()
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode,
          'feature.quick_assistant.model_id': preferences.quickModel
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
