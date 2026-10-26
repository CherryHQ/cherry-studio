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
  let failImages = false
  let assistantId: string | undefined
  const server = createServer((req, res) => {
    const handle = async () => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
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
            endpointConfigs: { 'openai-chat-completions': { baseUrl }, 'openai-image-generation': { baseUrl } },
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
            }
          ]
        })
        await window.api.preference.setMultiple({
          'feature.paintings.default_model_id': paintingModel,
          'topic.naming.enabled': false,
          'chat.input.toolbar.pinned_tools': ['generate-image']
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
    await composer.locator('[contenteditable="true"]').first().fill(prompt)
    await screenshot('MP-37 image generation enabled')
    await composer.getByRole('button', { name: 'Send', exact: true }).click()
    const messages = chat.locator('[data-ui~="chat.message"][data-message-id]:visible')
    const success = messages.filter({ hasText: 'MP37_IMAGE_DONE' })
    await expect(success).toBeVisible({ timeout: 60_000 })
    expect(imageRequests).toHaveLength(1)
    expect(imageRequests[0]).toMatchObject({ model: 'dall-e-3', prompt })
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

    failImages = true
    await composer.locator('[contenteditable="true"]').first().fill(prompt)
    await composer.getByRole('button', { name: 'Send', exact: true }).click()
    const failure = messages.filter({ hasText: 'MP37_FAILURE_DONE' })
    await expect(failure).toBeVisible({ timeout: 60_000 })
    expect(imageRequests).toHaveLength(2)
    const processDetails = failure.getByRole('button', { name: /^Processed/, expanded: false })
    if (await processDetails.isVisible()) await processDetails.click()
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
    await toggle.locator('..').hover()
    await expect(
      page.getByText('Configure a painting model in Settings › Default Model', { exact: true }).last()
    ).toBeVisible()
    await screenshot('MP-37 unconfigured profile guidance')
    expect(imageRequests).toHaveLength(2)
    await testInfo.attach('MP-37 provider requests and tool results', {
      body: JSON.stringify({ imageRequests, toolResults, topicId }),
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
