import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import { _electron, type ElectronApplication, expect, test } from '@playwright/test'
import sharp from 'sharp'

test('generated file references survive chat persistence and an application restart', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const image = await sharp({ create: { width: 256, height: 144, channels: 3, background: '#3377cc' } })
    .png()
    .toBuffer()
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push(JSON.parse(body))
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ created: 1, data: [{ b64_json: image.toString('base64') }] }))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Image fixture did not start')
  const suffix = `ImageWorkflowQA-${randomUUID()}`
  const launch = () =>
    _electron.launch({
      args: [resolve('.')],
      env: { ...process.env, NODE_ENV: 'production', CS_DEV_USER_DATA_SUFFIX: suffix }
    })
  let app: ElectronApplication | undefined
  try {
    app = await launch()
    const page = await app.firstWindow()
    await page.waitForFunction(() => Boolean(window.api?.dataApi))
    const seed = await page.evaluate(async (port) => {
      const data = async (method: 'POST' | 'PATCH', path: string, body: unknown): Promise<any> => {
        const result = await window.api.dataApi.request({ id: crypto.randomUUID(), method, path, body })
        if (result.error) throw new Error(result.error.message)
        return result.data
      }
      await window.api.preference.setMultiple({
        'app.language': 'en-US',
        'app.onboarding.provider_setup.status': 'skipped',
        'app.privacy.data_collection.enabled': false,
        'feature.quick_assistant.enabled': false,
        'feature.selection.enabled': false
      })
      const providerId = `image-qa-${Date.now()}`
      const baseUrl = `http://127.0.0.1:${port}/v1`
      await data('POST', '/providers', {
        providerId,
        presetProviderId: 'openai',
        name: 'Image QA',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: Object.fromEntries(
          ['openai-chat-completions', 'openai-responses', 'openai-image-generation', 'openai-image-edit'].map((key) => [
            key,
            { adapterFamily: 'openai', baseUrl }
          ])
        ),
        apiKeys: [{ id: 'test', key: 'local-test-only', isEnabled: true }]
      })
      await data('PATCH', `/providers/${providerId}`, { isEnabled: true })
      const [model] = await data('POST', '/models', [
        { providerId, modelId: 'gpt-image-2', presetModelId: 'gpt-image-2' }
      ])
      const response: any = await window.api.ipcApi.request('ai.image.generate', {
        requestId: crypto.randomUUID(),
        payload: {
          uniqueModelId: model.id,
          prompt: 'Blue test rectangle',
          mode: 'generate',
          paramValues: { imageResolution: '2K', aspectRatio: '16:9' },
          cleanupPolicy: 'manual'
        }
      })
      if (response.error) throw new Error(response.error.message)
      const files = (response.data ?? response).files as Array<{ id: string; name: string }>
      if (!files.length) throw new Error('No generated files')
      const assistant = await data('POST', '/assistants', { name: 'Image workflow QA' })
      const topic = await data('POST', '/topics', { name: 'Generated image reference QA', assistantId: assistant.id })
      await data('POST', `/topics/${topic.id}/messages`, {
        role: 'user',
        data: { parts: [{ type: 'text', text: 'Generate a blue rectangle' }] },
        status: 'success'
      })
      await data('POST', `/topics/${topic.id}/messages`, {
        role: 'assistant',
        data: {
          parts: [
            {
              type: 'dynamic-tool',
              toolName: 'generate_image',
              toolCallId: 'qa-image-call',
              state: 'output-available',
              input: { prompt: 'Blue test rectangle' },
              output: files.map(({ id, name }) => ({ id, name }))
            }
          ]
        },
        status: 'success'
      })
      return { topicId: topic.id, fileId: files[0].id }
    }, address.port)
    const openTopic = async (target: typeof page) => {
      await target.evaluate(
        ({ topicId }) =>
          window.api.ipcApi.request('navigation.open_route_in_main', { path: `/app/chat?topicId=${topicId}` }),
        seed
      )
      const accept = target.getByRole('button', { name: 'Accept and Continue', exact: true })
      if (await accept.count()) await accept.first().click()
      await target.waitForFunction(() =>
        Array.from(document.images).some((img) => img.naturalWidth === 256 && img.naturalHeight === 144)
      )
    }
    await openTopic(page)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ size: '2048x1152', prompt: 'Blue test rectangle' })
    const paintings: any = await page.evaluate(() =>
      window.api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path: '/paintings' })
    )
    expect(paintings.data.items).toEqual([])
    await page.getByRole('button', { name: 'Chat', exact: true }).first().click()
    await openTopic(page)
    await app.close()
    app = await launch()
    const reopened = await app.firstWindow()
    await reopened.waitForFunction(() => Boolean(window.api?.dataApi))
    await openTopic(reopened)
    expect(requests).toHaveLength(1)
    await testInfo.attach('image-after-restart', { body: await reopened.screenshot(), contentType: 'image/png' })
  } finally {
    await app?.close()
    server.close()
  }
})
