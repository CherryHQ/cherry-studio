import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { readFile, readdir, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'
import JSZip from 'jszip'
import sharp from 'sharp'

import { AssistantSchema } from '@shared/data/types/assistant'
import { type BranchMessagesResponse, MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { saveNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { sendChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function exportTopicFiles(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    markdownPath: await window.api.preference.get('data.export.markdown.path'),
    menuMode: await window.api.preference.get('menu.presentation_mode')
  }))
  const server = await startMockChatServer()
  const providerId = `regression-export-${Date.now()}`
  const topicName = app.resourceName('Export topic')
  const assistantName = app.resourceName('Export topic assistant')
  let assistantId: string | undefined

  const small = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#008866' } })
    .png()
    .toBuffer()
  const large = await sharp(randomBytes(1900 * 1900 * 3), { raw: { width: 1900, height: 1900, channels: 3 } })
    .png()
    .toBuffer()
  expect(large.length).toBeGreaterThan(10 * 1024 * 1024)
  const images = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' })
    response.end(request.url === '/large.png' ? large : small)
  })
  images.listen(0, '127.0.0.1')
  await once(images, 'listening')
  const address = images.address()
  if (!address || typeof address === 'string') throw new Error('Image fixture server has no port')
  const imageBase = `http://127.0.0.1:${address.port}`
  const output = join(app.paths.evidence, 'MP-47-exports')
  // ExportService stamps Markdown filenames with a timestamp, so a reused directory would hold
  // several .md files on a rerun and break the single-file assertions below.
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  try {
    await page.evaluate(
      (output) =>
        window.api.preference.setMultiple({
          'topic.naming.enabled': false,
          'data.export.markdown.path': output,
          'menu.presentation_mode': 'cherry'
        }),
      output
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Export topic mock',
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

    // Only provider replies and input images are fixtures; all exporters and file writes are real.
    const answer = [
      '## MP47 export heading',
      '```typescript\nconst mp47 = "export-contract"\n```',
      '> MP47 readable quotation',
      '[MP47 reference](https://example.org/mp47)',
      ...Array.from(
        { length: 90 },
        (_, index) => `MP47 paragraph ${String(index + 1).padStart(3, '0')}: preserve conversation order.`
      ),
      'MP47 final paragraph'
    ].join('\n\n')
    await Promise.all([
      sendChatMarker(page, 'MP47 first user paragraph', 'MP47 final paragraph'),
      (async () => {
        const request = await server.nextRequest()
        request.complete(answer)
      })()
    ])
    const stored = await readMessages()
    const user = stored.find(({ role }) => role === 'user')!
    const updated = await page.evaluate(
      async ({ id, parts, imageBase }) =>
        window.api.dataApi.request({
          id: 'mp47-image-precondition',
          method: 'PATCH',
          path: `/messages/${id}`,
          body: {
            data: {
              parts: [
                ...parts,
                { type: 'file', mediaType: 'image/png', filename: 'small.png', url: `${imageBase}/small.png` },
                { type: 'file', mediaType: 'image/png', filename: 'large.png', url: `${imageBase}/large.png` }
              ]
            }
          }
        }),
      { id: user.id, parts: (user.data.parts ?? []) as unknown[], imageBase }
    )
    expect(updated.status).toBe(200)
    await page.reload()
    await expect.poll(async () => (await readMessages()).map(({ role }) => role)).toEqual(['user', 'assistant'])
    await expect(page.getByText('MP47 final paragraph', { exact: true })).toBeVisible()
    await attachScreenshot('MP-47 source topic with code and images')
    const exportAs = async (label: string) => {
      await topicRow.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Export', exact: true }).hover()
      await page.getByRole('menuitem', { name: label, exact: true }).click()
    }
    await exportAs('Export as Markdown')
    const picker = page.getByRole('dialog', { name: 'Export images', exact: true })
    await expect(picker).toBeVisible()
    await picker.getByText('Embed in file (default)', { exact: true }).click()
    await attachScreenshot('MP-47 embed images option')
    await picker.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(page.getByText('Skipped 1 image(s) (over 10 MiB or unreadable)', { exact: true })).toBeVisible()
    await attachScreenshot('MP-47 oversized image skipped warning')
    const mdFiles = async () => (await readdir(output)).filter((name) => name.endsWith('.md'))
    await expect.poll(async () => (await mdFiles()).length).toBe(1)
    const markdownPath = join(output, (await mdFiles())[0])
    const markdown = await readFile(markdownPath, 'utf8')
    expect(markdown).toContain(`# ${topicName}`)
    expect(markdown).toContain('```typescript\nconst mp47 = "export-contract"\n```')
    expect(markdown).toContain('> MP47 readable quotation')
    expect(markdown).toContain('[MP47 reference](https://example.org/mp47)')
    expect(markdown).toContain(`data:image/png;base64,${small.toString('base64')}`)
    expect(markdown).not.toContain(large.toString('base64'))
    expect(markdown.indexOf('MP47 first user paragraph')).toBeLessThan(markdown.indexOf('MP47 export heading'))
    expect(markdown.indexOf('MP47 paragraph 001')).toBeLessThan(markdown.indexOf('MP47 paragraph 090'))
    await testInfo.attach('MP-47 exported Markdown', { path: markdownPath, contentType: 'text/markdown' })

    await exportAs('Export as Word')
    const wordPath = join(output, 'MP47.docx')
    saveNativeFile(app.record.platform, app.paths, wordPath)
    await expect.poll(async () => await readdir(output)).toContain('MP47.docx')
    const docx = await JSZip.loadAsync(await readFile(wordPath))
    expect(docx.file('[Content_Types].xml')).not.toBeNull()
    const xml = await docx.file('word/document.xml')!.async('text')
    const text = xml.replace(/<[^>]+>/g, '')
    const ordered = [
      'MP47 first user paragraph',
      'MP47 export heading',
      'export-contract',
      'MP47 readable quotation',
      'MP47 paragraph 001',
      'MP47 paragraph 090',
      'MP47 final paragraph'
    ]
    let previous = -1
    for (const marker of ordered) {
      const position = text.indexOf(marker)
      expect(position, `DOCX must contain ${marker} after preceding paragraph`).toBeGreaterThan(previous)
      previous = position
    }
    await testInfo.attach('MP-47 exported Word', {
      path: wordPath,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })
    await attachScreenshot('MP-47 Word export complete')

    await exportAs('Export as image')
    const progress = page.getByText('Exporting image. Please stay on this page.', { exact: true })
    await expect(progress).toBeVisible()
    await attachScreenshot('MP-47 image export progress')
    const imagePath = join(output, 'MP47.png')
    saveNativeFile(app.record.platform, app.paths, imagePath)
    await expect(page.getByText('Image saved successfully', { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(progress).toBeHidden()
    const exportedImages = (await readdir(output)).filter((name) => /\.png$/i.test(name))
    expect(exportedImages).toEqual(['MP47.png'])
    const image = sharp(await readFile(imagePath))
    const metadata = await image.metadata()
    expect(metadata.width).toBeGreaterThan(100)
    const viewportPixels = await page.evaluate(() => window.innerHeight * window.devicePixelRatio)
    expect(metadata.height!, 'Export must extend beyond the visible viewport').toBeGreaterThan(viewportPixels)
    const stats = await image.stats()
    expect(stats.channels.some(({ stdev }) => stdev > 1)).toBe(true)
    await testInfo.attach('MP-47 long conversation image', { path: imagePath, contentType: 'image/png' })
    await attachScreenshot('MP-47 image export complete')
  } finally {
    await server.close()
    images.closeAllConnections()
    await new Promise<void>((resolve, reject) => images.close((error) => (error ? reject(error) : resolve())))
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'data.export.markdown.path': preferences.markdownPath,
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
