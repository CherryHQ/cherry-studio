import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { efficiencyImage } from '../fixtures/chatEfficiencyServer'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

// HTTP fixtures replace only the external models; production tool execution and file persistence stay real.
export async function chatImageGeneration(app: RegressionApp, page: Page, testInfo: TestInfo) {
  const prompt = '一只橘猫在窗台上'
  const providerId = `mp37-${Date.now()}`
  const assistantName = app.resourceName('Image generation')
  const topicName = app.resourceName('Orange cat')
  const imageRequests: Record<string, unknown>[] = []
  const toolResults: unknown[] = []
  const imagenRequests: Record<string, any>[] = []
  const squareImage = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
    'base64'
  )
  let failImages = false
  let assistantId: string | undefined
  const server = createServer((req, res) => {
    const handle = async () => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      if (req.url?.endsWith(':predict')) {
        imagenRequests.push(body)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            predictions: [
              { bytesBase64Encoded: (imagenRequests.length === 1 ? efficiencyImage : squareImage).toString('base64') }
            ]
          })
        )
        return
      }
      if (req.url === '/v1/images/generations') {
        imageRequests.push(body)
        res.writeHead(failImages ? 401 : 200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify(
            failImages
              ? { error: { message: 'MP37 image provider unavailable', type: 'invalid_request_error' } }
              : { created: 1, data: [{ b64_json: efficiencyImage.toString('base64') }] }
          )
        )
        return
      }
      if (req.url !== '/v1/chat/completions') throw new Error(`Unexpected mock route: ${req.url}`)
      const lastUser = body.messages.findLastIndex((message: { role: string }) => message.role === 'user')
      const result = body.messages.slice(lastUser + 1).find((message: { role: string }) => message.role === 'tool')
      const tool = body.tools?.find((item: { function: { name: string } }) =>
        /generate_image$/.test(item.function.name)
      )
      if (!result && !tool) throw new Error('Generate image tool was not offered after enabling it')
      if (result) toolResults.push(result)
      const delta = result
        ? { content: failImages ? 'MP37_FAILURE_DONE' : 'MP37_IMAGE_DONE' }
        : {
            tool_calls: [
              {
                index: 0,
                id: `mp37-${imageRequests.length}`,
                type: 'function',
                function: { name: tool.function.name, arguments: JSON.stringify({ prompt }) }
              }
            ]
          }
      const chunk = (delta: object, finish: string | null) => ({
        id: 'chatcmpl-mp37',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'mp37-chat',
        choices: [{ index: 0, delta, finish_reason: finish }]
      })
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', ...delta }, null))}\n\n`)
      res.end(`data: ${JSON.stringify(chunk({}, result ? 'stop' : 'tool_calls'))}\n\ndata: [DONE]\n\n`)
    }
    void handle().catch((error) => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: String(error) } }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('MP37 mock did not bind')
  const baseUrl = `http://127.0.0.1:${address.port}/v1`
  const preferences = await page.evaluate(async () => ({
    model: await window.api.preference.get('feature.paintings.default_model_id'),
    naming: await window.api.preference.get('topic.naming.enabled'),
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
      'Loopback OpenAI chat/tool-call and image HTTP fixtures; real Electron composer, builtin painting tool, file persistence and preview. Does not validate external model quality.'
  })
  try {
    const seeded = await page.evaluate(
      async ({ providerId, baseUrl, paintingModel }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp37-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP37 HTTP fixture',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: {
              'openai-chat-completions': { baseUrl },
              'openai-image-generation': { baseUrl },
              'google-generate-content': { baseUrl, adapterFamily: 'google' }
            },
            apiKeys: [{ id: 'mock', key: 'mock', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp37-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const models = await window.api.dataApi.request({
          id: 'mp37-models',
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId: 'mp37-chat',
              endpointTypes: ['openai-chat-completions'],
              capabilities: ['function-call']
            },
            {
              providerId,
              modelId: 'dall-e-3',
              endpointTypes: ['openai-image-generation'],
              capabilities: ['image-generation']
            },
            {
              providerId,
              modelId: 'imagen-4-0-generate-001',
              endpointTypes: ['google-generate-content'],
              capabilities: ['image-generation']
            }
          ]
        })
        await window.api.preference.setMultiple({
          'feature.paintings.default_model_id': paintingModel,
          'topic.naming.enabled': false,
          'chat.input.toolbar.pinned_tools': ['generate-image', 'generate-image-geometry']
        })
        return [provider.status, enabled.status, models.status]
      },
      { providerId, baseUrl, paintingModel: createUniqueModelId(providerId, 'dall-e-3') }
    )
    expect(seeded).toEqual([201, 200, 201])
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp37-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, 'mp37-chat') }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ assistantId, name }) =>
        window.api.dataApi.request({
          id: 'mp37-topic',
          method: 'POST',
          path: '/topics',
          body: { assistantId, name }
        }),
      { assistantId, name: topicName }
    )
    expect(topic.status).toBe(201)
    const topicId = TopicSchema.parse(topic.data).id
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    const composer = chat.locator('[data-ui~="chat.composer"]')
    const toggle = composer.getByRole('button', { name: 'Generate image', exact: true })
    await expect(toggle).toBeEnabled()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await composer.getByRole('button', { name: 'Default image geometry' }).click()
    await page.getByRole('button', { name: /1792×1024/ }).click()
    await expect
      .poll(async () => {
        const response = await page.evaluate(
          (id) => window.api.dataApi.request({ id: 'mp37-read-assistant', method: 'GET', path: `/assistants/${id}` }),
          assistantId!
        )
        return AssistantSchema.parse(response.data).settings.imageGenerationGeometry
      })
      .toEqual({ size: '1792x1024' })
    await composer.getByRole('button', { name: 'Default image geometry' }).click()
    await screenshot('MP-37 image geometry presets')
    await page.keyboard.press('Escape')
    await composer.locator('[contenteditable="true"]').first().fill(prompt)
    await screenshot('MP-37 image generation enabled')
    await composer.getByRole('button', { name: 'Send', exact: true }).click()
    const messages = chat.locator('[data-ui~="chat.message"][data-message-id]:visible')
    const success = messages.filter({ hasText: 'MP37_IMAGE_DONE' })
    await expect(success).toBeVisible({ timeout: 60_000 })
    expect(imageRequests).toHaveLength(1)
    expect(imageRequests[0]).toMatchObject({ model: 'dall-e-3', prompt, size: '1792x1024' })
    await expect(success.getByText('Actual: 128 × 80 · 8:5', { exact: true })).toBeVisible()
    await screenshot('MP-37 actual dimensions caption')
    await expect(success.getByText('Generated image', { exact: true })).toBeVisible()
    const image = success.locator('img[src^="file:"]')
    await expect(image).toHaveCount(1)
    await expect(image).toBeVisible()
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
      .toBe(true)
    const src = await image.getAttribute('src')
    await image.click()
    const preview = page.getByRole('dialog')
    await expect(preview).toBeVisible()
    const previewImage = preview.locator('img').first()
    await expect(previewImage).toHaveAttribute('src', src!)
    await expect
      .poll(() => previewImage.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
      .toBe(true)
    await screenshot('MP-37 generated image large preview')
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const reopenedChat = page.locator('[data-ui~="chat.view"]:visible')
    const reopenedGroup = reopenedChat
      .locator('[data-ui~="chat.group-header"]')
      .filter({ hasText: assistantName })
      .first()
    await reopenedGroup.hover()
    const reopenExpand = reopenedGroup.getByRole('button', { name: 'Expand', exact: true })
    if (await reopenExpand.isVisible()) await reopenExpand.click()
    await reopenedChat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    await expect(reopenedChat.getByText('Actual: 128 × 80 · 8:5', { exact: true })).toBeVisible()
    await composer.getByRole('button', { name: 'Default image geometry' }).click()
    await expect(page.getByRole('button', { name: /1792×1024/ })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')

    await page.evaluate(
      (id) => window.api.preference.set('feature.paintings.default_model_id', id),
      createUniqueModelId(providerId, 'imagen-4-0-generate-001')
    )
    await composer.getByRole('button', { name: 'Default image geometry' }).click()
    await expect(page.getByText(/Saved choice unavailable/)).toBeVisible()
    await screenshot('MP-37 unavailable saved choice')
    await page.getByRole('button', { name: /16:9/ }).click()
    await expect
      .poll(async () => {
        const response = await page.evaluate(
          (id) => window.api.dataApi.request({ id: 'mp37-read-ratio', method: 'GET', path: `/assistants/${id}` }),
          assistantId!
        )
        return AssistantSchema.parse(response.data).settings.imageGenerationGeometry
      })
      .toEqual({ aspectRatio: 'ASPECT_16_9' })
    await composer.locator('[contenteditable="true"]').first().fill(prompt)
    await composer.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => imagenRequests.length, { timeout: 60_000 }).toBe(1)
    expect(imagenRequests[0].parameters.aspectRatio).toBe('16:9')
    await expect(
      messages.filter({ hasText: 'MP37_IMAGE_DONE' }).last().getByText('Actual: 128 × 80 · 8:5', { exact: true })
    ).toBeVisible({ timeout: 60_000 })
    await composer.locator('[contenteditable="true"]').first().fill(prompt)
    await composer.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => imagenRequests.length, { timeout: 60_000 }).toBe(2)
    await expect(
      messages
        .filter({ hasText: 'MP37_IMAGE_DONE' })
        .last()
        .getByText(/Actual: .* · 1:1/, { exact: true })
    ).toBeVisible({ timeout: 60_000 })

    await page.evaluate(
      (id) => window.api.preference.set('feature.paintings.default_model_id', id),
      createUniqueModelId(providerId, 'dall-e-3')
    )
    await composer.getByRole('button', { name: 'Default image geometry' }).click()
    await expect(page.getByText(/Saved choice unavailable/)).toBeVisible()
    const retained = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'mp37-read-retained', method: 'GET', path: `/assistants/${id}` }),
      assistantId!
    )
    expect(AssistantSchema.parse(retained.data).settings.imageGenerationGeometry).toEqual({
      aspectRatio: 'ASPECT_16_9'
    })
    await page.getByRole('button', { name: /Automatic \(no assistant default\)/ }).click()
    await expect
      .poll(async () => {
        const response = await page.evaluate(
          (id) => window.api.dataApi.request({ id: 'mp37-read-cleared', method: 'GET', path: `/assistants/${id}` }),
          assistantId!
        )
        return AssistantSchema.parse(response.data).settings.imageGenerationGeometry
      })
      .toBeNull()
    await composer.locator('[contenteditable="true"]').first().fill(prompt)
    await composer.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => imageRequests.length, { timeout: 60_000 }).toBe(2)
    expect(imageRequests[1]).not.toHaveProperty('size')
    await expect(
      messages.filter({ hasText: 'MP37_IMAGE_DONE' }).last().getByText('Generated image', { exact: true })
    ).toBeVisible({ timeout: 60_000 })

    failImages = true
    await composer.locator('[contenteditable="true"]').first().fill(prompt)
    await composer.getByRole('button', { name: 'Send', exact: true }).click()
    const failure = messages.filter({ hasText: 'MP37_FAILURE_DONE' })
    await expect(failure).toBeVisible({ timeout: 60_000 })
    expect(imageRequests).toHaveLength(3)
    const processDetails = failure.getByTestId('completed-process-trigger')
    await expect(processDetails).toBeVisible()
    if ((await processDetails.getAttribute('aria-expanded')) === 'false') await processDetails.click()
    const toolDetails = failure
      .getByTestId('child-tool-group')
      .getByRole('button', { name: /^Processed/ })
      .first()
    await expect(toolDetails).toBeVisible()
    if ((await toolDetails.getAttribute('aria-expanded')) === 'false') await toolDetails.click()
    await expect(failure.getByText('Image generation failed', { exact: true })).toBeVisible()
    await expect(failure.locator('img, .animate-pulse')).toHaveCount(0)
    await expect(failure.getByText('Generating image…', { exact: true })).toHaveCount(0)
    await screenshot('MP-37 readable provider failure without blank image')

    // Turn this isolated QA profile into the unconfigured profile, preserving all other inputs.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await page.evaluate(() => window.api.preference.set('feature.paintings.default_model_id', null))
    await expect(toggle).toBeDisabled()
    await composer.locator('[contenteditable="true"]').first().fill(prompt)
    const toggleBox = await toggle.boundingBox()
    if (!toggleBox) throw new Error('Generate image control has no visible layout')
    await page.mouse.click(toggleBox.x + toggleBox.width / 2, toggleBox.y + toggleBox.height / 2)
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await composer.locator('[contenteditable="true"]').first().hover()
    await toggle.locator('..').hover()
    await expect(
      page.getByText('Configure a painting model in Settings › Default Model', { exact: true }).last()
    ).toBeVisible()
    await screenshot('MP-37 unconfigured profile guidance')
    expect(imageRequests).toHaveLength(3)
    await testInfo.attach('MP-37 provider requests and tool results', {
      body: JSON.stringify({ imageRequests, imagenRequests, toolResults, topicId }),
      contentType: 'application/json'
    })
  } finally {
    await page.evaluate(
      async ({ preferences, assistantId, providerId }) => {
        await window.api.preference.setMultiple({
          'feature.paintings.default_model_id': preferences.model,
          'topic.naming.enabled': preferences.naming,
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
        await window.api.dataApi.request({ id: 'mp37-delete', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { preferences, assistantId, providerId }
    )
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
      server.closeAllConnections()
    })
  }
}
