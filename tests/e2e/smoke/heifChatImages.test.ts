import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import { createUniqueModelId } from '../../../src/shared/data/types/model'
import type { OutputFor } from '../../../src/shared/ipc/types'
import { type MockChatRequest, startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const PNG_SIGNATURE = '89504e470d0a1a0a'
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function expectPngPayload(body: string): Promise<void> {
  const images = [...body.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]*)/g)]
  expect(
    images,
    `Exactly one PNG payload must reach the vision model. Body prefix: ${body.slice(0, 400)}`
  ).toHaveLength(1)
  const png = Buffer.from(images[0][1], 'base64')
  expect(png.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE)
  const metadata = await sharp(png).metadata()
  expect([metadata.width, metadata.height]).toEqual([96, 64])
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  for (const [x, y, color] of [
    [2, 2, [220, 30, 40]],
    [72, 16, [30, 160, 60]],
    [24, 48, [40, 60, 200]],
    [72, 48, [245, 245, 245]]
  ] as const) {
    for (const [channel, expected] of color.entries()) {
      const observed = data[(y * info.width + x) * info.channels + channel]
      expect(
        Math.abs(observed - expected),
        `Pixel (${x}, ${y}), channel ${channel}: ${observed} vs ${expected}`
      ).toBeLessThanOrEqual(8)
    }
  }
  expect(body).not.toMatch(/image\/hei[cf]|\bheic\b/i)
  expect(body).not.toMatch(/(?:[A-Za-z]:[\\/]|\/(?:Users|Volumes|private|tmp)\/)/)
  expect(body).not.toContain('fileEntryId')
  expect(body).not.toContain('file://')
}

test('HEIF chat displays PNG renditions, preserves originals and rejects unsupported sends', async ({
  electronApp,
  mainWindow: page
}, testInfo) => {
  test.setTimeout(180_000)
  const server = await startMockChatServer()
  const providerId = `heif-smoke-${Date.now()}`
  const originalDialog = await electronApp.evaluateHandle(({ dialog }) => dialog.showOpenDialog)
  const requests: MockChatRequest[] = []
  let closing = false
  const observeRequests = async () => {
    while (!closing) {
      try {
        requests.push(await server.nextRequest())
      } catch (error) {
        if (!closing && !(error instanceof Error && error.message === 'Timed out waiting for a mock chat request')) {
          throw error
        }
      }
    }
  }
  const observation = observeRequests()
  try {
    expect(process.env.CS_DEV_PROFILE_ROOT, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
    const fixtureRoot = testInfo.outputPath('fixtures')
    await mkdir(fixtureRoot, { recursive: true })
    for (const name of ['quadrants.heic', 'quadrants-truncated.heic', 'quadrants.png']) {
      await copyFile(path.resolve('tests/fixtures/heif', name), path.join(fixtureRoot, name))
    }
    const originalBytes = await readFile(path.join(fixtureRoot, 'quadrants.heic'))
    const screenshot = async (name: string) => {
      const output = testInfo.outputPath(`${name}.png`)
      await page.screenshot({ path: output })
      await testInfo.attach(name, { path: output, contentType: 'image/png' })
    }
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
            name: 'HEIF smoke mock',
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
    const models = await page.evaluate(
      ({ providerId, modelId }) =>
        window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [
            { providerId, modelId, inputModalities: ['text', 'image'], endpointTypes: ['openai-chat-completions'] },
            { providerId, modelId: 'mock-text', inputModalities: ['text'], endpointTypes: ['openai-chat-completions'] }
          ]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(models.status).toBe(201)
    const assistantName = `Attachment smoke ${providerId}`
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'attachment-smoke-assistant',
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
    const assistantRow = chatView.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    const newChat = async () => {
      await assistantRow.hover()
      await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toBeVisible()
    }
    const composer = uiLocator(page, 'chat.composer').filter({ visible: true }).first()
    const editor = composer.locator('[contenteditable="true"]').first()
    const activeAttachment = (name: string) =>
      editor
        .locator('[data-composer-token-node]')
        .filter({ hasText: name })
        .locator('[data-composer-token-kind="file"]')
    const send = async (name: string) => {
      await expect(activeAttachment(name)).toBeVisible()
      await testInfo.attach('composer-before-send', {
        body: await composer.evaluate((node) => node.outerHTML.slice(0, 4096)),
        contentType: 'text/html'
      })
      await page.getByRole('button', { name: 'Send', exact: true }).click()
    }
    const pick = async (name: string) => {
      await expect(editor).toHaveText('')
      await expect(composer.locator('[data-composer-token-kind="file"]')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
      await electronApp.evaluate(
        ({ dialog }, filePath) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
        },
        path.join(fixtureRoot, name)
      )
      try {
        const launcher = composer.getByRole('button', { name: 'Upload attachment', exact: true })
        if (await launcher.isVisible()) await launcher.click()
        else {
          await composer.getByRole('button', { name: 'Input Quick Panel', exact: true }).click()
          await page.getByRole('button', { name: /^Upload attachment\b/ }).click()
        }
        await expect(composer.getByText(name, { exact: true })).toBeVisible()
        await expect(activeAttachment(name)).toBeVisible()
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
        await expect(page.getByText('Model does not support this file type', { exact: true })).toHaveCount(0)
        await expect(page.getByText(/\d+ files are not supported/)).toHaveCount(0)
      } finally {
        await electronApp.evaluate(({ dialog }, original) => {
          dialog.showOpenDialog = original
        }, originalDialog)
      }
    }
    const sendImage = async (name: string, marker: string) => {
      await pick(name)
      await editor.press('ControlOrMeta+End')
      await editor.type(marker)
      const before = requests.length
      await send(name)
      await expect.poll(() => requests.length).toBe(before + 1)
      const request = requests[before]
      const json = JSON.stringify(request.body, null, 2)
      const output = testInfo.outputPath(`${marker}-request.json`)
      await writeFile(output, json)
      await testInfo.attach(`${marker}-request`, { path: output, contentType: 'application/json' })
      await expectPngPayload(json)
      expect(json).not.toContain(fixtureRoot)
      request.complete(marker)
      await expect(uiLocator(page, 'chat.message').filter({ hasText: marker }).last()).toBeVisible()
      await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeHidden()
      return request
    }

    await test.step('Original HEIC token previews decoded PNG before sending', async () => {
      await newChat()
      await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
      await pick('quadrants.heic')
      await composer.getByText('quadrants.heic', { exact: true }).hover()
      const preview = page.locator('[data-file-token-image-preview] img').filter({ visible: true }).last()
      await expect(preview).toBeVisible()
      await expect.poll(() => preview.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      const bytes = await preview.evaluate(async (image) => {
        const response = await fetch((image as HTMLImageElement).src)
        return Array.from(new Uint8Array(await response.arrayBuffer()))
      })
      expect(Buffer.from(bytes).subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE)
      expect(sha256(Buffer.from(bytes))).not.toBe(sha256(originalBytes))
      await screenshot('heif-composer-preview')
      await editor.press('ControlOrMeta+End')
      await editor.type('HEIF vision evidence')
      const before = requests.length
      await send('quadrants.heic')
      await expect.poll(() => requests.length).toBe(before + 1)
      const request = requests[before]
      const json = JSON.stringify(request.body, null, 2)
      const output = testInfo.outputPath('heif-vision-request.json')
      await writeFile(output, json)
      await testInfo.attach('heif-vision-request', { path: output, contentType: 'application/json' })
      await expectPngPayload(json)
      expect(json).not.toContain(fixtureRoot)
      request.complete('HEIF_VISION_OK')
      await expect(page.getByText('HEIF_VISION_OK', { exact: true })).toBeVisible()
      await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeHidden()
    })

    await test.step('Managed original retains its name and exact bytes', async () => {
      const stored = await page.evaluate(async () => {
        const response = await window.api.dataApi.request({ id: 'heif-entries', method: 'GET', path: '/files/entries' })
        if (response.status !== 200) throw new Error(JSON.stringify(response))
        const body = response.data as { items: { id: string; name: string; ext: string }[] }
        const entry = body.items.find((item) => item.name === 'quadrants' && item.ext === 'heic')
        if (!entry) throw new Error('Original quadrants.heic entry not found')
        const resolved = (await window.api.ipcApi.request('file.batch_get_physical_paths', { ids: [entry.id] })) as {
          ok: boolean
          data?: OutputFor<'file.batch_get_physical_paths'>
        }
        if (!resolved.ok || !resolved.data?.[entry.id]) throw new Error('Managed HEIC path unavailable')
        return { ...entry, filename: `${entry.name}.${entry.ext}`, physicalPath: resolved.data[entry.id] }
      })
      expect(stored.filename).toBe('quadrants.heic')
      expect(stored.ext.toLowerCase()).toMatch(/^\.?heic$/)
      const managedHash = sha256(await readFile(stored.physicalPath!))
      expect(managedHash).toBe(sha256(originalBytes))
      const wire = JSON.stringify(requests[0].body)
      expect(wire).not.toContain(stored.physicalPath!)
      expect(wire).not.toContain(stored.id)
      await testInfo.attach('original-integrity', {
        body: JSON.stringify({ name: stored.filename, originalHash: sha256(originalBytes), managedHash }, null, 2),
        contentType: 'application/json'
      })
    })

    await test.step('Reloaded sent image opens a rendered lightbox', async () => {
      await page.reload()
      await expect(page.getByText('HEIF_VISION_OK', { exact: true })).toBeVisible()
      const image = uiLocator(page, 'chat.message').locator('img[src^="blob:"]').filter({ visible: true }).first()
      await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      await image.click()
      const lightbox = page.getByTestId('image-preview-dialog')
      await expect(lightbox).toBeVisible()
      const fullImage = lightbox.locator('img').filter({ visible: true }).first()
      await expect.poll(() => fullImage.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      await screenshot('heif-reloaded-lightbox')
      await page.keyboard.press('Escape')
      await expect(lightbox).toBeHidden()
    })

    await test.step('Corrupt HEIC stops before any chat request', async () => {
      await newChat()
      await pick('quadrants-truncated.heic')
      await editor.press('ControlOrMeta+End')
      await editor.type('Reject corrupt HEIF')
      const before = requests.length
      await send('quadrants-truncated.heic')
      await expect(page.getByText('This HEIC/HEIF image could not be converted.', { exact: false })).toBeVisible()
      await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeHidden()
      expect(requests.length - before, 'Corrupt HEIF must produce zero chat requests').toBe(0)
      await screenshot('heif-corrupt-error')
    })

    await test.step('Non-vision model rejects HEIF with localized OCR limitation', async () => {
      const changed = await page.evaluate(
        async ({ assistantId, modelId }) =>
          window.api.dataApi.request({
            id: 'heif-text-model',
            method: 'PATCH',
            path: `/assistants/${assistantId}`,
            body: { modelId }
          }),
        { assistantId: (assistant.data as { id: string }).id, modelId: createUniqueModelId(providerId, 'mock-text') }
      )
      expect(changed.status).toBe(200)
      await page.reload()
      await newChat()
      await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText('mock-text')
      await pick('quadrants.heic')
      await editor.press('ControlOrMeta+End')
      await editor.type('Reject HEIF OCR')
      const before = requests.length
      await send('quadrants.heic')
      await expect(page.getByText('OCR for HEIC/HEIF images is not supported yet.', { exact: false })).toBeVisible()
      await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeHidden()
      expect(requests.length - before, 'Non-vision HEIF must produce zero chat requests').toBe(0)
      await testInfo.attach('ocr-observation-gap', {
        body: 'mockChatServer exposes chat completion requests only; zero OCR invocations require separate runtime instrumentation. See attachmentRouting.test.ts for the before-OCR regression assertion.',
        contentType: 'text/plain'
      })
      await screenshot('heif-non-vision-error')
    })

    await test.step('Ordinary PNG still reaches the vision wire', async () => {
      const changed = await page.evaluate(
        async ({ assistantId, modelId }) =>
          window.api.dataApi.request({
            id: 'heif-vision-model',
            method: 'PATCH',
            path: `/assistants/${assistantId}`,
            body: { modelId }
          }),
        { assistantId: (assistant.data as { id: string }).id, modelId: createUniqueModelId(providerId, server.modelId) }
      )
      expect(changed.status).toBe(200)
      await page.reload()
      await newChat()
      await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
      await sendImage('quadrants.png', 'PNG_CONTROL_OK')
    })
  } catch (error) {
    const output = testInfo.outputPath('heif-failure.png')
    await page.screenshot({ path: output })
    await testInfo.attach('heif-failure', { path: output, contentType: 'image/png' })
    throw error
  } finally {
    closing = true
    try {
      await electronApp.evaluate(({ dialog }, original) => {
        dialog.showOpenDialog = original
      }, originalDialog)
    } finally {
      await server.close()
      await observation
      await originalDialog.dispose()
    }
  }
})
