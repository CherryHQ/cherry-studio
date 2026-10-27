import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { chooseNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import { efficiencyImage, startChatEfficiencyServer } from '../fixtures/chatEfficiencyServer'
import { openAttachmentPicker, sendChatMarker, submitChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

// Catch dropped/duplicated queued drafts and broken attachment/tool-result interactions in the real app.
export async function chatEfficiency(app: RegressionApp, page: Page, testInfo: TestInfo) {
  const server = await startChatEfficiencyServer()
  const providerId = `mp18-${Date.now()}`
  const assistantName = app.resourceName(`Efficiency assistant ${providerId}`)
  const topicName = app.resourceName(`会话效率测试 ${providerId}`)
  let assistantId: string | undefined
  let serverId: string | undefined
  const preferences = await page.evaluate(async () => ({
    naming: await window.api.preference.get('topic.naming.enabled'),
    menu: await window.api.preference.get('menu.presentation_mode'),
    pinned: await window.api.preference.get('chat.input.toolbar.pinned_tools')
  }))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat and MCP image tool; real Electron UI, queue, IPC, persistence, image rendering and link navigation.'
  })
  try {
    const seeded = await page.evaluate(
      async ({ providerId, baseUrl, origin }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': false,
          'menu.presentation_mode': 'cherry',
          'chat.input.toolbar.pinned_tools': ['attachment']
        })
        const provider = await window.api.dataApi.request({
          id: 'mp18-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP18 mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock', key: 'mock', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp18-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await window.api.dataApi.request({
          id: 'mp18-model',
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId: 'mock-chat',
              endpointTypes: ['openai-chat-completions'],
              capabilities: ['function-call', 'image-recognition']
            }
          ]
        })
        const mcp = await window.api.dataApi.request({
          id: 'mp18-mcp',
          method: 'POST',
          path: '/mcp-servers',
          body: { name: providerId, type: 'streamableHttp', baseUrl: `${origin}/mcp`, isActive: true, isTrusted: true }
        })
        return { statuses: [provider.status, enabled.status, model.status, mcp.status], mcp: mcp.data }
      },
      { providerId, baseUrl: server.baseUrl, origin: server.origin }
    )
    serverId = (seeded.mcp as { id: string }).id
    expect(seeded.statuses).toEqual([201, 200, 201, 201])
    const assistant = await page.evaluate(
      ({ name, modelId, serverId }) =>
        window.api.dataApi.request({
          id: 'mp18-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId, mcpServerIds: [serverId] }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId), serverId }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({ id: 'mp18-topic', method: 'POST', path: '/topics', body: { name, assistantId } }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    const topicId = TopicSchema.parse(topic.data).id
    const readMessages = async () => {
      const response = await page.evaluate(
        (topicId) =>
          window.api.dataApi.request({ id: 'mp18-messages', method: 'GET', path: `/topics/${topicId}/messages` }),
        topicId
      )
      expect(response.status).toBe(200)
      return (
        response.data as { items: { message: { role: string; status: string; data?: { parts: unknown[] } } }[] }
      ).items.map(({ message }) => message)
    }
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    const row = chat.locator(`#resource-list-option-${topicId}`)
    await row.click()
    const composer = chat.locator('[data-ui~="chat.composer"]')
    const editor = composer.locator('[contenteditable="true"]').first()
    const send = async (text: string) => {
      await editor.fill(text)
      await composer.getByRole('button', { name: 'Send', exact: true }).click()
    }
    await send('MP18_LONG: Give a long explanation and wait for my follow-ups.')
    const running = await server.nextRequest()
    running.sendText('MP18 long answer is still streaming. '.repeat(20))
    await expect(chat.getByText(/MP18 long answer is still streaming/).first()).toBeVisible()
    await send('MP18_EDIT_ORIGINAL')
    await send('MP18_REMOVE')
    await expect(page.getByRole('button', { name: 'Queued (2)', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Queued (2)', exact: true }).click()
    await screenshot('MP-18 two queued messages during stream')
    const queueId = await page.getByRole('button', { name: 'Queued (2)', exact: true }).getAttribute('aria-controls')
    expect(queueId).toBeTruthy()
    const queue = page.locator(`[id="${queueId}"]`)
    await queue.getByRole('button', { name: 'Edit', exact: true }).first().click()
    await expect(editor).toHaveText('MP18_EDIT_ORIGINAL')
    await expect(page.getByRole('button', { name: 'Queued (1)', exact: true })).toBeVisible()
    await send('MP18_EDITED')
    await expect(page.getByRole('button', { name: 'Queued (2)', exact: true })).toBeVisible()
    await queue.getByRole('button', { name: 'Remove', exact: true }).first().click()
    await expect(page.getByText('MP18_REMOVE', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Pause auto-send', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Resume auto-send', exact: true })).toBeVisible()
    running.complete('MP18_LONG_DONE')
    await expect.poll(async () => (await readMessages()).map(({ status }) => status)).toEqual(['success', 'success'])
    const idleRequest = await server.nextRequest(1500).then(
      () => true,
      (error: Error) => {
        if (!error.message.includes('Timed out')) throw error
        return false
      }
    )
    expect(idleRequest, 'Paused queue must not auto-send').toBe(false)
    await expect(page.getByRole('button', { name: 'Queued (1)', exact: true })).toBeVisible()
    await screenshot('MP-18 paused queue after reply completed')
    await queue.getByRole('button', { name: 'steer', exact: true }).click()
    const manual = await server.nextRequest()
    const userInputs = manual.body.messages.filter((message) => (message as { role: string }).role === 'user')
    expect(userInputs).toEqual([
      expect.objectContaining({ content: 'MP18_LONG: Give a long explanation and wait for my follow-ups.' }),
      expect.objectContaining({ content: 'MP18_EDITED' })
    ])
    manual.complete('MP18_MANUAL_DONE')
    await expect
      .poll(async () => (await readMessages()).map(({ role, status }) => [role, status]))
      .toEqual([
        ['user', 'success'],
        ['assistant', 'success'],
        ['user', 'success'],
        ['assistant', 'success']
      ])
    await expect(page.getByRole('button', { name: /^Queued \(/ })).toHaveCount(0)
    await row.hover()
    const hover = page.locator('[data-slot="hover-card-content"]').filter({ hasText: 'Last activity:' })
    await expect(hover).toContainText(topicName)
    await expect(hover).toContainText(/Last activity:\s*\S+/)
    await screenshot('MP-18 populated conversation hover card')
    await editor.click()

    const imagePath = join(app.paths.fixtures, 'mp18-attachment.png')
    await writeFile(imagePath, efficiencyImage)
    await editor.fill('MP18_ATTACHMENT: Acknowledge this uploaded image.')
    await openAttachmentPicker(page, composer)
    chooseNativeFile(app.record.platform, app.paths, imagePath)
    await expect(composer).toContainText('mp18-attachment.png')
    await Promise.all([
      submitChatMarker(page, 'MP18_ATTACHMENT_DONE'),
      (async () => {
        const request = await server.nextRequest()
        expect(JSON.stringify(request.body.messages)).toContain('image_url')
        request.complete('MP18_ATTACHMENT_DONE')
      })()
    ])
    const attachment = chat.locator('[data-ui~="chat.message"] [data-ui~="chat.image-block"]').getByRole('img').last()
    await expect(attachment).toBeVisible()
    const attachmentSource = await attachment.getAttribute('src')
    await attachment.click()
    const preview = page.getByRole('dialog')
    await expect(preview).toBeVisible()
    await expect(preview.locator('img').first()).toHaveAttribute('src', attachmentSource!)
    await expect
      .poll(() =>
        preview
          .locator('img')
          .first()
          .evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)
      )
      .toBe(true)
    await screenshot('MP-18 sent attachment preview')
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    await attachment.click({ button: 'right' })
    const copySource = page.getByRole('menuitem', { name: 'Copy Image Source', exact: true })
    await expect(page.getByRole('menuitem', { name: 'Copy as image', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Save As', exact: true })).toBeVisible()
    await expect(copySource).toBeVisible()
    await screenshot('MP-18 sent attachment context menu')
    await copySource.click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(attachmentSource)

    const messageId = await sendChatMarker(
      page,
      'MP18_IMAGE_URL: Use the image tool to give an image URL and details link.',
      'MP18_IMAGE_DONE'
    )
    expect(server.toolCalls).toBe(1)
    const message = chat.locator(`[data-message-id="${messageId}"]`)
    await message.getByTestId('completed-process-trigger').click()
    await message.getByTestId('child-tool-group').getByRole('button', { expanded: false }).first().click()
    const tool = message.locator('[data-ui~="chat.tool"]')
    await expect(tool).toBeVisible()
    const disclosure = tool.getByRole('button', { expanded: false }).first()
    if (await disclosure.isVisible()) await disclosure.click()
    const image = tool.getByRole('img', { name: 'Tool output', exact: true })
    await expect(image).toBeVisible()
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
      .toBe(true)
    await expect(tool.getByRole('link', { name: 'MP-18 image', exact: true })).toHaveAttribute(
      'href',
      `${server.origin}/image.png`
    )
    testInfo.annotations.push({
      type: 'uncovered',
      description:
        'Public tool-result image URL previews require a public host; loopback image URLs fall back to links.'
    })
    await screenshot('MP-18 inline tool image and private URL fallback')
    const currentUrl = page.url()
    const link = tool.getByRole('link', { name: 'MP-18 image details', exact: true })
    await expect(link).toHaveAttribute('href', `${server.origin}/details`)
    await link.click()
    await expect.poll(() => server.linkVisits).toBeGreaterThan(0)
    expect(page.url()).toBe(currentUrl)
    await page.getByRole('button', { name: 'Open global search', exact: true }).click()
    const search = page.getByRole('dialog', { name: 'Open global search', exact: true })
    await search.getByRole('combobox').fill('会话效率')
    await expect(search.getByRole('option').filter({ hasText: topicName })).toBeVisible()
    await screenshot('MP-18 search by Chinese conversation title')
    await page.keyboard.press('Escape')
    await expect(search).toBeHidden()
    testInfo.annotations.push({
      type: 'uncovered',
      description: 'Conversation search by pinyin initials is not verified.'
    })
    await screenshot('MP-18 efficiency workflow complete')
  } finally {
    await server.close()
    await page.evaluate(
      async ({ preferences, assistantId, providerId, serverId }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.naming,
          'menu.presentation_mode': preferences.menu,
          'chat.input.toolbar.pinned_tools': preferences.pinned
        })
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        if (serverId) await window.api.ipcApi.request('mcp.server.remove', { serverId })
        await window.api.dataApi.request({ id: 'mp18-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { preferences, assistantId, providerId, serverId }
    )
  }
}
