import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { type BranchMessagesResponse, MessageSchema, type Message } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { hasOwnedAppActiveTasks } from '../../../../scripts/e2e/regression/debugBridge'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { sendChatMarker } from '../helpers/chat'
import { dismissOnboarding, selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim()

const textOf = (message: Message) =>
  (message.data?.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => ('text' in part ? part.text : ''))
    .join('')

export async function chatStreamingStopContinue(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  let pageRef = page
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(pageRef, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const namingEnabled = await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))
  // The mock drips chunks on demand, so streaming growth, Stop, and the stopped body are deterministic.
  const server = await startMockChatServer()
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const providerId = `regression-mp02-${Date.now()}`
  const assistantName = app.resourceName('Streaming stop assistant')
  const prompt = 'hello, answer in one sentence'
  const firstChunk = 'The mock answer begins with orchids '
  const secondChunk = 'and continues with cedar trees.'
  const stoppedText = firstChunk + secondChunk
  const continuePrompt = 'Continue in one short sentence.'
  const continueAnswer = 'MP02 continued reply after stop.'
  let assistantId: string | undefined
  let stoppedMessageId = ''
  let topicId = ''

  try {
    await pageRef.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    const provider = await pageRef.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Streaming stop mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    expect(provider.status).toBe(201)
    const enabled = await pageRef.evaluate(
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
    const models = await pageRef.evaluate(
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
    const assistant = await pageRef.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp02-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id

    await pageRef.reload()
    await selectSidebarApp(pageRef, 'Chat')
    const chat = pageRef.locator('[data-ui~="chat.view"]:visible')
    await expect(chat).toBeVisible({ timeout: 30_000 })
    const assistantRow = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(assistantRow).toBeVisible({ timeout: 30_000 })
    await assistantRow.hover()
    await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).click()
    await expect(pageRef.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    const messages = chat.locator('[data-ui~="chat.message"][data-message-id]:visible')
    const editor = pageRef.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
    const pauseButton = pageRef.locator('[data-ui~="chat.composer.action.pause"]')
    const streaming = pageRef
      .locator('[data-ui~="chat.message"][data-message-id]:visible')
      .filter({ has: pageRef.locator('.message-assistant') })
      .last()

    await test.step('characters stream in incrementally, not as one block', async () => {
      await editor.fill(prompt)
      await pageRef.getByRole('button', { name: 'Send', exact: true }).click()
      const request = await server.nextRequest()
      expect(request.body).toMatchObject({
        model: server.modelId,
        stream: true,
        messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: prompt })])
      })
      request.sendText(firstChunk)
      await expect(streaming, 'the first characters must appear within 5 seconds').toContainText('orchids', {
        timeout: 5_000
      })
      const firstSample = normalizeText(await streaming.innerText())
      expect(firstSample).not.toContain('cedar')
      await delay(400)
      request.sendText(secondChunk)
      await expect(streaming).toContainText('cedar')
      const secondSample = normalizeText(await streaming.innerText())
      expect(
        secondSample.length,
        'the reply must keep growing after the first characters, not arrive as one block'
      ).toBeGreaterThan(firstSample.length)
      await expect(pauseButton).toBeVisible()
      await testInfo.attach('MP-02 streaming samples', {
        body: JSON.stringify({ firstSample, secondSample }),
        contentType: 'application/json'
      })
      await attachScreenshot('MP-02 streaming reply with stop control')

      const stoppedId = await streaming.getAttribute('data-message-id')
      if (!stoppedId) throw new Error('Streaming response has no message ID')
      stoppedMessageId = stoppedId
      let cancelled = false
      void request.closed.then(() => (cancelled = true))
      await pauseButton.click()
      await expect
        .poll(() => cancelled, { timeout: 10_000, message: 'Stop must cancel the in-flight provider request' })
        .toBe(true)
      await expect
        .poll(
          async () => {
            const response = await pageRef.evaluate(
              (id) => window.api.dataApi.request({ id: 'mp02-read-stopped', method: 'GET', path: `/messages/${id}` }),
              stoppedMessageId
            )
            expect(response.status).toBe(200)
            const message = MessageSchema.parse(response.data)
            topicId = message.topicId
            return { id: message.id, status: message.status, text: textOf(message) }
          },
          { timeout: 30_000, message: 'Stop must persist the partial reply' }
        )
        .toStrictEqual({ id: stoppedMessageId, status: 'paused', text: stoppedText })
      await expect(pauseButton).toBeHidden()
      await expect(pageRef.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
      await attachScreenshot('MP-02 stopped partial reply')
    })

    await test.step('nothing is appended for 10 seconds after Stop', async () => {
      const stoppedUiText = normalizeText(await streaming.innerText())
      await pageRef.waitForTimeout(10_000)
      expect(
        normalizeText(await streaming.innerText()),
        'no characters may be appended within 10 seconds of Stop'
      ).toBe(stoppedUiText)
      await attachScreenshot('MP-02 stopped reply stays partial')
    })

    await test.step('resending after Stop completes and returns the input to a sendable state', async () => {
      await Promise.all([
        sendChatMarker(pageRef, continuePrompt, continueAnswer),
        (async () => {
          const followUp = await server.nextRequest()
          expect(followUp.body.messages).toContainEqual(
            expect.objectContaining({ role: 'user', content: continuePrompt })
          )
          followUp.complete(continueAnswer)
        })()
      ])
      await expect(pauseButton).toHaveCount(0)
      await expect(editor).toBeEditable()
      await attachScreenshot('MP-02 continued conversation after stop')
    })

    await test.step('persisted messages match the UI in count and body', async () => {
      const response = await pageRef.evaluate(
        (topicId) =>
          window.api.dataApi.request({
            id: 'mp02-topic-messages',
            method: 'GET',
            path: `/topics/${topicId}/messages`
          }),
        topicId
      )
      expect(response.status).toBe(200)
      const branch = response.data as BranchMessagesResponse
      expect(branch.nextCursor).toBeUndefined()
      const persisted = branch.items.map(({ message }) => MessageSchema.parse(message))
      expect(persisted.map(({ role }) => role)).toEqual(['user', 'assistant', 'user', 'assistant'])
      expect(persisted[0].searchableText).toBe(prompt)
      expect(persisted[2].searchableText).toBe(continuePrompt)
      expect(persisted[3].searchableText).toBe(continueAnswer)
      expect(persisted[1].id).toBe(stoppedMessageId)
      expect(textOf(persisted[1])).toBe(stoppedText)
      expect(textOf(persisted[3])).toBe(continueAnswer)
      const visibleIds = await messages.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-message-id'))
      )
      expect(visibleIds, 'the visible conversation must be exactly the persisted messages in order').toEqual(
        persisted.map(({ id }) => id)
      )
    })

    await test.step('a full restart restores the topic once, without duplicating messages', async () => {
      await expect
        .poll(() => hasOwnedAppActiveTasks(app.record), {
          timeout: 15_000,
          message: 'Stopped streams must release main-process activity before the restart'
        })
        .toBe(false)
      const beforeRestart = await pageRef.evaluate(
        (topicId) =>
          window.api.dataApi.request({
            id: 'mp02-topic-messages-before-restart',
            method: 'GET',
            path: `/topics/${topicId}/messages`
          }),
        topicId
      )
      expect(beforeRestart.status).toBe(200)
      const persisted = (beforeRestart.data as BranchMessagesResponse).items.map(({ message }) =>
        MessageSchema.parse(message)
      )
      expect(persisted).toHaveLength(4)

      pageRef = await app.restart()
      await dismissOnboarding(pageRef)
      await selectSidebarApp(pageRef, 'Chat')
      const restoredChat = pageRef.locator('[data-ui~="chat.view"]:visible')
      await expect(restoredChat).toBeVisible({ timeout: 30_000 })
      const restoredGroup = restoredChat
        .locator('[data-ui~="chat.group-header"]')
        .filter({ hasText: assistantName })
        .first()
      await expect(restoredGroup).toBeVisible({ timeout: 30_000 })
      await restoredGroup.hover()
      const expand = restoredGroup.getByRole('button', { name: 'Expand', exact: true })
      if (await expand.isVisible().catch(() => false)) await expand.click()
      const topicRow = restoredChat.locator(`[id="resource-list-option-${encodeURIComponent(topicId)}"]`)
      await expect(topicRow, 'the topic must be listed exactly once after restart').toHaveCount(1)
      await topicRow.click()
      const restoredMessages = restoredChat.locator('[data-ui~="chat.message"][data-message-id]:visible')
      await expect(restoredMessages).toHaveCount(4)
      await expect(restoredMessages.filter({ hasText: stoppedText.trim() })).toHaveCount(1)
      await expect(restoredMessages.filter({ hasText: continueAnswer })).toHaveCount(1)
      const restoredIds = await restoredMessages.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-message-id'))
      )
      expect(restoredIds, 'restart must restore the same messages without duplicates').toEqual(
        persisted.map(({ id }) => id)
      )
      const afterRestart = await pageRef.evaluate(
        (topicId) =>
          window.api.dataApi.request({
            id: 'mp02-topic-messages-restart',
            method: 'GET',
            path: `/topics/${topicId}/messages`
          }),
        topicId
      )
      expect(afterRestart.status).toBe(200)
      const reloaded = (afterRestart.data as BranchMessagesResponse).items.map(({ message }) =>
        MessageSchema.parse(message)
      )
      expect(reloaded.map(({ id, role, status }) => ({ id, role, status }))).toEqual(
        persisted.map(({ id, role, status }) => ({ id, role, status }))
      )
      expect(reloaded.map(textOf)).toEqual(persisted.map(textOf))
      await attachScreenshot('MP-02 topic restored once after restart')
    })
  } finally {
    await server.close()
    if (pageRef.isClosed()) pageRef = await app.mainWindow()
    await pageRef.evaluate(
      async ({ assistantId, providerId, namingEnabled }) => {
        await window.api.preference.set('topic.naming.enabled', namingEnabled)
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
      { assistantId, providerId, namingEnabled }
    )
  }
}
