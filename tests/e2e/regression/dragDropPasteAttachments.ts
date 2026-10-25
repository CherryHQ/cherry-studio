import { readFile, writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { type BranchMessagesResponse, MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'

export async function dragDropPasteAttachments(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode'),
    pasteEnabled: await window.api.preference.get('chat.input.paste_long_text_as_file'),
    pasteThreshold: await window.api.preference.get('chat.input.paste_long_text_threshold')
  }))
  const server = await startMockChatServer()
  const providerId = `regression-mp33-${Date.now()}`
  const topicName = app.resourceName('MP33 attachments')
  const assistantName = app.resourceName('MP33 attachments assistant')
  let assistantId: string | undefined

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'topic.naming.enabled': false,
        'menu.presentation_mode': 'cherry',
        'chat.input.paste_long_text_as_file': true,
        'chat.input.paste_long_text_threshold': 1500
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
            name: 'MP33 attachments mock',
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
          id: 'mp33-assistant',
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
          id: 'mp33-topic',
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
            id: 'mp33-read',
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
    const composer = chat.locator('[data-ui~="chat.composer"]')
    const editor = composer.locator('[contenteditable="true"]').first()
    const tokens = composer.locator('[data-composer-token-kind="file"]')
    const asset = (name: string) => app.fixturesPath('edge', name)
    const chineseName = '中文 文件名 带空格.txt'
    const chineseText = await readFile(asset(chineseName), 'utf8')
    const longText = await readFile(asset('long-text-20k.txt'), 'utf8')
    expect(longText.length).toBeGreaterThan(20_000)
    const cdp = await page.context().newCDPSession(page)
    const drop = async (name: string) => {
      await editor.scrollIntoViewIfNeeded()
      const bounds = await editor.boundingBox()
      expect(bounds).not.toBeNull()
      const position = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 }
      // CDP supplies native, path-backed File objects to Electron's real drop handler.
      for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
        await cdp.send('Input.dispatchDragEvent', {
          type,
          ...position,
          data: { items: [], files: [asset(name)], dragOperationsMask: 1 }
        })
      }
    }
    const send = async (prompt: string, expectedText?: string) => {
      await expect(editor).toBeEditable({ timeout: 5_000 })
      await editor.click()
      await editor.press('ControlOrMeta+End')
      await page.keyboard.insertText(` ${prompt}`)
      await expect(editor).toContainText(prompt, { timeout: 5_000 })
      const answer = `MP33_RECEIVED_${prompt}`
      await Promise.all([
        (async () => {
          await composer.getByRole('button', { name: 'Send', exact: true }).click()
          await expect(messages.filter({ has: page.locator('.message-assistant') }).last()).toContainText(answer)
          await expect.poll(async () => (await readMessages()).at(-1)?.status).toBe('success')
        })(),
        (async () => {
          const request = await server.nextRequest(30_000)
          try {
            expect(request.body.model).toBe(server.modelId)
            const user = request.body.messages
              .filter((message) => (message as { role: string }).role === 'user')
              .at(-1) as { content: string | { type: string; text?: string }[] }
            const content =
              typeof user.content === 'string' ? user.content : user.content.map((part) => part.text ?? '').join('\n')
            expect(content).toContain(prompt)
            // Trailing whitespace of a text file is not part of the assertion: compare the payloads with
            // trailing blank lines trimmed on both sides so a fixture's final newline does not fail the case.
            if (expectedText)
              expect
                .soft(content.trimEnd(), 'Complete attachment content must reach the model')
                .toContain(expectedText.trimEnd())
            expect(content).not.toContain('MP33_REJECTED_BINARY_CONTENT')
            expect(content).not.toContain('unsupported.exe')
          } finally {
            request.complete(answer)
          }
        })()
      ])
      await expect(tokens).toHaveCount(0)
    }
    const preview = async (name: string, contents: string) => {
      await messages
        .locator('[data-ui~="chat.message-attachments"]')
        .getByRole('button', { name: 'Preview', exact: true })
        .last()
        .click()
      const overlay = page.getByRole('dialog')
      await expect(overlay).toBeVisible()
      await expect(overlay.getByRole('heading')).toContainText(
        name === chineseName ? name.replace(/\.txt$/, '') : 'Pasted Text'
      )
      const content = overlay.locator('.cm-content')
      await expect(content).toBeVisible()
      await content.click()
      await content.press('ControlOrMeta+a')
      await content.press('ControlOrMeta+c')
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(contents)
      await attachScreenshot(`MP-33 preview ${name}`)
      await overlay.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(overlay).toBeHidden()
    }
    const messages = chat.locator('[data-ui~="chat.message"][data-message-id]:visible')
    try {
      await drop(chineseName)
      await expect(tokens).toHaveCount(1)
      await expect(tokens).toHaveText(chineseName)
      await attachScreenshot('MP-33 Chinese filename with spaces in composer')
      // Only model responses are mocked; assert the actual HTTP input contains the complete file.
      await send('MP33_CHINESE', chineseText)
      await preview(chineseName, chineseText)

      await page.evaluate((text) => navigator.clipboard.writeText(text), longText)
      await editor.click()
      await editor.press('ControlOrMeta+v')
      await expect(tokens).toHaveCount(1)
      await expect(tokens).toHaveText('Pasted text.txt')
      await expect(editor).not.toContainText('MP33_LONG_BEGIN')
      await attachScreenshot('MP-33 long text converted to attachment')
      await send('MP33_LONG', longText)
      await preview('Pasted text.txt', longText)

      await drop('unsupported.exe')
      await expect(page.getByText(/not supported|unsupported|不支持/i).last()).toBeVisible()
      await expect(tokens).toHaveCount(0)
      await attachScreenshot('MP-33 executable rejected without attachment')
      await send('MP33_AFTER_REJECTION')
      const finalMessages = await readMessages()
      const users = finalMessages.filter(({ role }) => role === 'user')
      expect(users).toHaveLength(3)
      expect((users[2].data.parts ?? []).some(({ type }) => type === 'file')).toBe(false)
      await expect(messages).toHaveCount(6)
      await expect(editor).toBeEditable({ timeout: 5_000 })
      await attachScreenshot('MP-33 all three operations remain responsive')
    } finally {
      await cdp.detach()
    }
  } finally {
    await server.close()
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode,
          'chat.input.paste_long_text_as_file': preferences.pasteEnabled,
          'chat.input.paste_long_text_threshold': preferences.pasteThreshold
        })
        if (assistantId) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        await window.api.dataApi.request({ id: 'mp33-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { assistantId, providerId, preferences }
    )
  }
}
