import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import JSZip from 'jszip'
import officeParser from 'officeparser'
import sharp from 'sharp'

import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { type MockChatRequest, startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

// Catches DOCX text-only delivery and reordered or duplicated embedded image payloads.
test('Chat delivers canonical DOCX text and two embedded images in document order', async ({
  electronApp,
  mainWindow: page
}, testInfo) => {
  test.setTimeout(180_000)
  const server = await startMockChatServer()
  const providerId = `docx-inline-${Date.now()}`
  const originalDialog = await electronApp.evaluateHandle(({ dialog }) => dialog.showOpenDialog)
  try {
    expect(process.env.CS_DEV_PROFILE_ROOT, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
    const root = testInfo.outputPath('fixtures')
    await mkdir(root, { recursive: true })
    const images = await Promise.all([
      sharp({ create: { width: 256, height: 128, channels: 3, background: '#ff0000' } })
        .png()
        .toBuffer(),
      sharp({ create: { width: 128, height: 256, channels: 3, background: '#0000ff' } })
        .png()
        .toBuffer()
    ])
    const zip = new JSZip()
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    )
    zip.file(
      '_rels/.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    )
    zip.file(
      'word/document.xml',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Before red image</w:t></w:r></w:p><w:p><w:r><w:drawing><a:blip r:embed="red"/></w:drawing></w:r></w:p><w:p><w:r><w:t>Between images</w:t></w:r></w:p><w:p><w:r><w:drawing><a:blip r:embed="blue"/></w:drawing></w:r></w:p><w:p><w:r><w:t>After blue image</w:t></w:r></w:p></w:body></w:document>'
    )
    zip.file(
      'word/_rels/document.xml.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="red" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/red.png"/><Relationship Id="blue" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/blue.png"/></Relationships>'
    )
    zip.file('word/media/red.png', images[0])
    zip.file('word/media/blue.png', images[1])
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    const fixturePath = path.join(root, 'inline-images.docx')
    await writeFile(fixturePath, bytes)
    const canonicalText = (await officeParser.parseOfficeAsync(bytes)).trim()
    await testInfo.attach('DOCX fixture', {
      path: fixturePath,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })
    for (const [index, image] of images.entries())
      await testInfo.attach(`source-image-${index}`, { body: image, contentType: 'image/png' })
    await testInfo.attach('fixture hashes', {
      body: JSON.stringify(
        {
          docx: createHash('sha256').update(bytes).digest('hex'),
          images: images.map((image) => createHash('sha256').update(image).digest('hex')),
          canonicalText
        },
        null,
        2
      ),
      contentType: 'application/json'
    })

    const languageSelect = page.locator('[data-onboarding-language-select]')
    await expect(uiLocator(page, 'chat.composer').or(languageSelect).filter({ visible: true }).first()).toBeVisible()
    if (await languageSelect.isVisible()) {
      await languageSelect.getByRole('combobox').click()
      await page.getByRole('option', { name: 'English', exact: false }).click()
      await page.getByRole('button', { name: 'Set up later', exact: true }).click()
    }
    await selectSidebarApp(page, 'Chat')
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'DOCX inline mock',
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
          id: `${providerId}-enable`,
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const model = await page.evaluate(
      ({ providerId, modelId }) =>
        window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId,
              endpointTypes: ['openai-chat-completions'],
              capabilities: ['image-recognition'],
              contextWindow: 1_000_000
            }
          ]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(model.status).toBe(201)
    const assistantName = `DOCX inline ${providerId}`
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'docx-inline-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    await page.reload()
    const chatView = page.locator('[data-ui~="chat.view"]:visible')
    await expect(chatView).toBeVisible()
    const row = chatView.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await row.hover()
    await row.getByRole('button', { name: 'New Chat', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    const composer = uiLocator(page, 'chat.composer').filter({ visible: true }).first()
    const prompt = `Read embedded images ${providerId}`
    await composer.locator('[contenteditable="true"]').first().fill(prompt)
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
    }, fixturePath)
    const launcher = composer.getByRole('button', { name: 'Upload attachment', exact: true })
    if (await launcher.isVisible()) await launcher.click()
    else {
      await composer.getByRole('button', { name: 'Input Quick Panel', exact: true }).click()
      await page.getByRole('button', { name: /^Upload attachment\b/ }).click()
    }
    await expect(composer.getByText('inline-images.docx', { exact: true })).toBeVisible()
    const attachedScreenshot = testInfo.outputPath('composer-attachment.png')
    await page.screenshot({ path: attachedScreenshot })
    await testInfo.attach('composer with DOCX attachment', { path: attachedScreenshot, contentType: 'image/png' })
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    let matched: MockChatRequest | undefined
    let content: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
    const deadline = Date.now() + 30_000
    while (!matched && Date.now() < deadline) {
      const request = await server.nextRequest(Math.max(1, deadline - Date.now()))
      const user = request.body.messages
        .map((message) => message as { role?: string; content?: unknown })
        .filter((message) => message.role === 'user')
        .at(-1)
      const parts = Array.isArray(user?.content)
        ? user.content
        : typeof user?.content === 'string'
          ? [{ type: 'text', text: user.content }]
          : []
      if (
        request.body.model === server.modelId &&
        parts.some((part) => part.type === 'text' && part.text.includes(prompt))
      ) {
        matched = request
        content = parts
      } else request.complete('Background request complete')
    }
    const requestPath = testInfo.outputPath('request.json')
    await writeFile(requestPath, JSON.stringify(matched?.body ?? { error: 'No matching request captured' }, null, 2))
    await testInfo.attach('captured request', { path: requestPath, contentType: 'application/json' })
    expect(matched, 'The intended user request must reach the mock server').toBeDefined()
    const text = content
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('')
    expect(text).toContain(canonicalText)
    expect(text).not.toContain('[DOCX images:')
    expect(text).not.toContain('[DOCX embedded images could not')
    const imageIndices = content.flatMap((part, index) => (part.type === 'image_url' ? [index] : []))
    expect(imageIndices).toHaveLength(2)
    expect(content.slice(0, imageIndices[0]).some((part) => part.text?.includes('Before red image'))).toBe(true)
    expect(
      content.slice(imageIndices[0] + 1, imageIndices[1]).some((part) => part.text?.includes('Between images'))
    ).toBe(true)
    expect(content.slice(imageIndices[1] + 1).some((part) => part.text?.includes('After blue image'))).toBe(true)
    const decoded: Buffer[] = []
    for (const [index, partIndex] of imageIndices.entries()) {
      const url = content[partIndex].image_url!.url
      expect(url).toMatch(/^data:image\/png;base64,/u)
      const image = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64')
      decoded.push(image)
      expect(await sharp(image).metadata()).toMatchObject(
        index === 0 ? { width: 256, height: 128, format: 'png' } : { width: 128, height: 256, format: 'png' }
      )
      expect(await sharp(image).raw().toBuffer()).toEqual(await sharp(images[index]).raw().toBuffer())
      await testInfo.attach(`delivered-image-${index}`, { body: image, contentType: 'image/png' })
    }
    expect(createHash('sha256').update(decoded[0]).digest('hex')).not.toBe(
      createHash('sha256').update(decoded[1]).digest('hex')
    )
    const marker = `DOCX_INLINE_OK_${providerId}`
    matched!.complete(marker)
    await expect(uiLocator(page, 'chat.message').filter({ hasText: marker })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeHidden()
    const completedScreenshot = testInfo.outputPath('completed-reply.png')
    await page.screenshot({ path: completedScreenshot })
    await testInfo.attach('completed reply', { path: completedScreenshot, contentType: 'image/png' })
  } catch (error) {
    const failureScreenshot = testInfo.outputPath('docx-inline-failure.png')
    await page.screenshot({ path: failureScreenshot })
    await testInfo.attach('DOCX inline failure', { path: failureScreenshot, contentType: 'image/png' })
    throw error
  } finally {
    try {
      await electronApp.evaluate(({ dialog }, original) => {
        dialog.showOpenDialog = original
      }, originalDialog)
    } finally {
      await server.close()
      await originalDialog.dispose()
    }
  }
})
