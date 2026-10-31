import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, type Page } from '@playwright/test'

import type { BranchMessagesResponse } from '../../../../src/shared/data/types/message'
import { createUniqueModelId } from '../../../../src/shared/data/types/model'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../../regression/navigation'
import { uiLocator } from './uiLocator'

/** Exercise the real editor, persistence, rendering, and provider request with only the picker substituted. */
export async function verifyComposerOrder(page: Page, selectFile: (file: string) => Promise<void>, output: string) {
  const server = await startMockChatServer()
  const providerId = `composer-order-${Date.now()}`
  const name = `Composer order ${providerId}`
  const preferences = await page.evaluate(async () => ({
    language: await window.api.preference.get('app.language'),
    naming: await window.api.preference.get('topic.naming.enabled')
  }))
  try {
    await mkdir(output, { recursive: true })
    await writeFile(
      path.join(output, 'order.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64'
      )
    )
    await writeFile(path.join(output, 'order.txt'), 'DOCUMENT_CONTENT_SENTINEL')
    await page.evaluate(async () => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('topic.naming.enabled', false)
    })
    await page.reload()
    const setupLater = page.getByRole('button', { name: 'Set up later', exact: true })
    if (await setupLater.isVisible()) await setupLater.click()
    await selectSidebarApp(page, 'Chat')
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: 'order-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Composer order mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'order-enable',
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
          id: 'order-model',
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId,
              endpointTypes: ['openai-chat-completions'],
              capabilities: ['image-recognition'],
              inputModalities: ['text', 'image']
            }
          ]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'order-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'order-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name, assistantId: (assistant.data as { id: string }).id }
    )
    expect(topic.status).toBe(201)
    await page.reload()
    const row = page.getByRole('option').filter({ hasText: name })
    if (!(await row.isVisible())) {
      await page.getByRole('listbox').getByRole('button', { name, exact: true }).click()
    }
    await row.click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    const composer = uiLocator(page, 'chat.composer').filter({ visible: true }).first()
    const editor = composer.locator('[contenteditable="true"]').first()
    const focusEnd = async () => {
      await editor.evaluate((element) => {
        const selection = window.getSelection()!
        const range = document.createRange()
        range.selectNodeContents(element)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
        ;(element as HTMLElement).focus()
      })
    }
    await editor.fill('ORDER_BEFORE 中文😀 ')
    await focusEnd()
    for (const [filename, suffix] of [
      ['order.png', ' ORDER_BETWEEN '],
      ['order.txt', ' ORDER_AFTER']
    ]) {
      await selectFile(path.join(output, filename))
      const upload = composer.getByRole('button', { name: 'Upload attachment', exact: true })
      if (await upload.isVisible()) await upload.click()
      else {
        await composer.getByRole('button', { name: 'Input Quick Panel', exact: true }).click()
        await page.getByRole('button', { name: /^Upload attachment\b/ }).click()
      }
      await expect(composer.getByText(filename, { exact: true })).toBeVisible()
      await focusEnd()
      await page.keyboard.insertText(suffix)
    }
    await page.keyboard.press('Escape')
    await composer.screenshot({ path: path.join(output, 'composer-before.png'), timeout: 10000 })
    await composer.getByRole('button', { name: 'Send', exact: true }).click()
    const request = await server.nextRequest(30_000)
    const user = request.body.messages
      .map((message) => message as { role: string; content: unknown })
      .filter((message) => message.role === 'user')
      .at(-1)!
    const content = user.content as Array<{ type: string; text?: string }>
    expect(content.filter((part) => part.type === 'image_url')).toHaveLength(1)
    const ordered = content.map((part) => (part.type === 'image_url' ? '<IMAGE>' : (part.text ?? ''))).join('')
    expect(ordered).toMatch(
      /ORDER_BEFORE 中文😀[\s\S]*\[Attachment 1: "order.png"\][\s\S]*<IMAGE>[\s\S]*ORDER_BETWEEN[\s\S]*\[Attachment 2: "order.txt"\][\s\S]*DOCUMENT_CONTENT_SENTINEL[\s\S]*ORDER_AFTER/
    )
    await writeFile(path.join(output, 'request.json'), JSON.stringify(request.body, null, 2))
    request.complete('ORDER_VERIFIED')
    await expect(uiLocator(page, 'chat.message').filter({ hasText: 'ORDER_VERIFIED' })).toBeVisible()
    await page.reload()
    const sent = uiLocator(page, 'chat.message').filter({ hasText: 'ORDER_BEFORE' }).first()
    await expect(sent).toBeVisible()
    await expect(sent).toContainText('ORDER_BETWEEN')
    await expect(sent).toContainText('ORDER_AFTER')
    await expect(uiLocator(sent, 'chat.image-block')).toHaveCount(1)
    await expect(sent.getByRole('button', { name: 'order', exact: true })).toHaveCount(1)
    await sent.screenshot({ path: path.join(output, 'sent-after-reload.png'), timeout: 10000 })
    const persisted = await page.evaluate(
      (topicId) =>
        window.api.dataApi.request({
          id: 'order-reload',
          method: 'GET',
          path: `/topics/${topicId}/messages`
        }),
      (topic.data as { id: string }).id
    )
    expect(persisted.status).toBe(200)
    const persistedUser = (persisted.data as BranchMessagesResponse).items
      .map((item) => item.message)
      .find((item) => item.role === 'user')!
    expect(persistedUser.data.parts?.map((part) => part.type)).toEqual(['text', 'file', 'text', 'file', 'text'])
    await writeFile(path.join(output, 'persisted-message.json'), JSON.stringify(persistedUser, null, 2))

    await sent.hover()
    await sent.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(editor).toContainText('order.png')
    await expect(editor).toContainText('order.txt')
    const restored = await editor.innerText()
    expect(restored).toMatch(/ORDER_BEFORE[\s\S]*order.png[\s\S]*ORDER_BETWEEN[\s\S]*order.txt[\s\S]*ORDER_AFTER/)
    const imageToken = composer.locator('[data-composer-token-kind="file"]').filter({ hasText: 'order.png' })
    await imageToken.hover()
    const removeImage = imageToken.locator('[data-composer-token-remove]')
    await removeImage.focus()
    await removeImage.press('Enter')
    await expect(editor).not.toContainText('order.png')
    await composer.getByRole('button', { name: 'Send', exact: true }).click()
    const resent = await server.nextRequest(30000)
    const resentUser = resent.body.messages
      .map((message) => message as { role: string; content: unknown })
      .filter((message) => message.role === 'user')
      .at(-1)!
    const resentContent = JSON.stringify(resentUser.content)
    expect(resentContent).not.toContain('image_url')
    expect(resentContent).not.toContain('order.png')
    expect(resentContent).not.toContain('Attachment 2')
    expect(resentContent).toContain('Attachment 1')
    expect(resentContent).toMatch(
      /ORDER_BEFORE[\s\S]*ORDER_BETWEEN[\s\S]*Attachment 1[\s\S]*DOCUMENT_CONTENT_SENTINEL[\s\S]*ORDER_AFTER/
    )
    await writeFile(path.join(output, 'request-after-delete.json'), JSON.stringify(resent.body, null, 2))
    resent.complete('ORDER_EDIT_VERIFIED')
    await expect(uiLocator(page, 'chat.message').filter({ hasText: 'ORDER_EDIT_VERIFIED' })).toBeVisible()
  } finally {
    await page.evaluate(async (previous) => {
      await window.api.preference.set('app.language', previous.language)
      await window.api.preference.set('topic.naming.enabled', previous.naming)
    }, preferences)
    await server.close()
  }
}
