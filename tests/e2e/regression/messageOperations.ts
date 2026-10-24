import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { type BranchMessagesResponse, MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { sendChatMarker } from './chat'
import { openLaunchpadApp, selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'

export async function messageOperations(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode'),
    speechModel: await window.api.preference.get('feature.voice.speech.model_id')
  }))
  const server = await startMockChatServer()
  const providerId = `regression-mp28-${Date.now()}`
  const topicName = app.resourceName('MP28 message operations')
  const assistantName = app.resourceName('MP28 message operations assistant')
  let assistantId: string | undefined

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'topic.naming.enabled': false,
        'menu.presentation_mode': 'cherry',
        'feature.voice.speech.model_id': ''
      })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP28 message operations mock',
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
          id: 'mp28-assistant',
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
          id: 'mp28-topic',
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
            id: 'mp28-read',
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
    const firstPrompt = 'Give me a short JavaScript example.'
    const firstAnswer = 'MP28 original reply.\n\n```javascript\nconst orchard = 28;\n```'
    const lastPrompt = 'Describe an orange.'
    const lastAnswer = 'MP28 oranges are round.'
    const editedPrompt = 'Describe a blue bicycle instead.'
    const editedAnswer = 'MP28 a blue bicycle has two wheels.'
    const regeneratedAnswer = 'MP28 regenerated bicycle response.'
    const reply = async (prompt: string, answer: string, marker = answer) => {
      await Promise.all([
        sendChatMarker(page, prompt, marker),
        (async () => {
          const request = await server.nextRequest()
          expect(request.body.messages).toContainEqual(expect.objectContaining({ role: 'user', content: prompt }))
          request.complete(answer)
        })()
      ])
    }
    // Only the provider is mocked; clipboard, editing, branches and speech errors use the real application.
    await reply(firstPrompt, firstAnswer, 'MP28 original reply.')
    await reply(lastPrompt, lastAnswer)
    await expect(messages).toHaveCount(4)
    const original = await readMessages()
    expect(original.map(({ role }) => role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    const firstReply = messages.filter({ hasText: 'MP28 original reply.' })
    await firstReply.hover()
    await firstReply.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(firstAnswer)

    await attachScreenshot('MP-28 four-message conversation and copied reply')
    await page.evaluate(async () => {
      const info = (await window.api.ipcApi.request('app.get_info')) as IpcResult<OutputFor<'app.get_info'>>
      if (!info.ok) throw new Error('Cannot resolve the test notes directory')
      await window.api.file.mkdir(info.data.notesPath)
    })
    await openLaunchpadApp(page, 'Notes')
    const notes = page.locator('[data-ui~="notes.view"]:visible')
    await expect(notes).toBeVisible()
    await attachScreenshot('MP-28 Notes application window')
    await notes.getByRole('button', { name: 'Create a new note', exact: true }).first().click()
    const noteEditor = page.locator('[data-ui~="notes.editor"] [contenteditable="true"]')
    await expect(noteEditor).toBeVisible()
    await noteEditor.click()
    await page.keyboard.press('ControlOrMeta+V')
    await expect(noteEditor).toContainText('MP28 original reply.')
    await expect(noteEditor).toContainText('const orchard = 28;')
    expect(await noteEditor.innerText()).not.toMatch(/Regenerate|Read aloud|More|Copy/)
    await attachScreenshot('MP-28 reply copied and pasted into Notes')

    await selectSidebarApp(page, 'Chat')
    await topicRow.click()
    const paragraph = firstReply.getByText('MP28 original reply.', { exact: true })
    await paragraph.click({ clickCount: 3 })
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe('MP28 original reply.')
    await paragraph.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Quote', exact: true }).click()
    const quote = chat.locator('[data-ui~="chat.composer"] [data-composer-token-kind="quote"]')
    await expect(quote).toBeVisible()
    await quote.hover()
    await expect(page.getByRole('tooltip')).toContainText('MP28 original reply.')
    await attachScreenshot('MP-28 quote summary in composer')
    const composer = chat.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
    await composer.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await expect(quote).toHaveCount(0)

    const lastUser = messages.filter({ hasText: lastPrompt })
    await lastUser.hover()
    await lastUser.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(composer).toContainText(lastPrompt)
    await reply(editedPrompt, editedAnswer)
    await expect(messages).toHaveCount(4)
    await expect(messages.nth(0)).toContainText(firstPrompt)
    await expect(messages.nth(1)).toContainText('MP28 original reply.')
    await expect(messages.nth(2)).toContainText(editedPrompt)
    await expect(messages.nth(3)).toContainText(editedAnswer)
    const edited = await readMessages()
    expect(edited.map(({ role }) => role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(edited.slice(0, 2).map(({ id }) => id)).toEqual(original.slice(0, 2).map(({ id }) => id))
    expect(edited[2].id).not.toBe(original[2].id)
    expect(edited[2].parentId).toBe(original[1].id)
    expect(edited[3].parentId).toBe(edited[2].id)
    const retained = await page.evaluate(
      (id) =>
        window.api.dataApi.request({
          id: 'mp28-original-branch',
          method: 'GET',
          path: `/messages/${id}`
        }),
      original[2].id
    )
    expect(retained.status).toBe(200)
    expect(MessageSchema.parse(retained.data).searchableText).toBe(lastPrompt)
    await attachScreenshot('MP-28 edited user message and new branch')

    await messages.nth(3).hover()
    await Promise.all([
      messages.nth(3).getByRole('button', { name: 'Regenerate', exact: true }).click(),
      (async () => {
        const request = await server.nextRequest()
        const history = request.body.messages.filter((m) => (m as { role: string }).role !== 'system')
        expect(history).toEqual([
          { role: 'user', content: firstPrompt },
          { role: 'assistant', content: firstAnswer },
          { role: 'user', content: editedPrompt }
        ])
        request.complete(regeneratedAnswer)
      })()
    ])
    await expect(messages.nth(3)).toContainText(regeneratedAnswer)
    await expect(messages).toHaveCount(4)
    await expect(messages.filter({ hasText: editedAnswer })).toHaveCount(0)
    await expect
      .poll(async () =>
        (await readMessages()).map(({ role, searchableText, status }) => ({ role, searchableText, status }))
      )
      .toEqual([
        { role: 'user', searchableText: firstPrompt, status: 'success' },
        { role: 'assistant', searchableText: firstAnswer, status: 'success' },
        { role: 'user', searchableText: editedPrompt, status: 'success' },
        { role: 'assistant', searchableText: regeneratedAnswer, status: 'success' }
      ])
    await messages.nth(3).hover()
    await messages.nth(3).getByRole('button', { name: 'Read aloud', exact: true }).click()
    await expect(page.getByText('Not configured', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Voice Settings', exact: true })).toBeVisible()
    await attachScreenshot('MP-28 regenerated reply and unconfigured speech warning')

    const beforeDelete = await readMessages()
    const removedId = beforeDelete[3].id
    await messages.nth(3).hover()
    await messages.nth(3).getByRole('button', { name: 'Delete', exact: true }).click()
    const confirmation = page.getByRole('dialog')
    await expect(confirmation).toContainText('Are you sure you want to delete this message?')
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(messages.filter({ hasText: regeneratedAnswer })).toHaveCount(0)
    await expect
      .poll(async () => {
        const response = await page.evaluate(
          (id) =>
            window.api.dataApi.request({
              id: 'mp28-deleted',
              method: 'GET',
              path: `/messages/${id}`
            }),
          removedId
        )
        return response.status
      })
      .toBe(404)
    const afterDelete = await readMessages()
    expect(afterDelete.some(({ id }) => id === removedId)).toBe(false)
    expect(afterDelete.slice(0, 3).map(({ id }) => id)).toEqual(beforeDelete.slice(0, 3).map(({ id }) => id))
    await attachScreenshot('MP-28 regenerated reply deleted')
  } finally {
    await server.close()
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode,
          'feature.voice.speech.model_id': preferences.speechModel
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
