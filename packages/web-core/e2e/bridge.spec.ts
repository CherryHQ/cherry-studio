import type { Page } from '@playwright/test'

import type { CoreClient } from '../src/client/CoreClient'
import { expect, test } from './fixtures'
import { MOCK_PROVIDER_PORT } from './mockProvider'

const MOCK_PROVIDER = `http://localhost:${MOCK_PROVIDER_PORT}`

// The page sees the desktop renderer's services; typed here only as far as the tests use them.
interface Bridge {
  client: CoreClient
  api: {
    dataApi: { onDataChanged(callback: (effects: { endpoint: string }[]) => void): () => void }
    preference: {
      subscribe(keys: string[]): Promise<void>
      onChanged(callback: (key: string, value: unknown) => void): () => void
    }
    cache: { getAllShared(): Promise<Record<string, { value: unknown }>> }
  }
  electron: { ipcRenderer: { invoke(channel: string, ...args: unknown[]): Promise<unknown> } }
  cacheService: { setShared(key: string, value: unknown): void; getShared(key: string): unknown }
  dataApiService: {
    get(path: string, options?: { query?: unknown }): Promise<any>
    post(path: string, options: { body: unknown }): Promise<any>
  }
  preferenceService: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }
  ipcApi: {
    request(route: string, input?: unknown): Promise<any>
    on(event: string, callback: (payload: any) => void): () => void
  }
  ipcChatTransport: { sendMessages(options: Record<string, unknown>): Promise<ReadableStream<unknown>> }
}

declare global {
  var bridge: Bridge
}

async function gotoBridge(page: Page, account: string) {
  await page.goto('/bridge.html')
  await page.waitForFunction(() => globalThis.bridge !== undefined)
  await page.evaluate((account) => bridge.client.open(account), account)
}

test('runs the desktop preload in the page over the Core Worker IPC', async ({ page, account }) => {
  await gotoBridge(page, account)
  const result = await page.evaluate(async () => {
    const unregistered = await bridge.electron.ipcRenderer.invoke('no-such-channel').catch((error: Error) => error)
    return {
      unregistered: (unregistered as Error).message,
      topics: await bridge.dataApiService.get('/topics', { query: { limit: 10 } }),
      attach: await bridge.ipcApi.request('ai.stream.attach', { topicId: 'no-such-topic' })
    }
  })
  expect(result.unregistered).toContain("No handler registered for 'no-such-channel'")
  expect(result.topics).toMatchObject({ items: [] })
  expect(result.attach).toEqual({ status: 'not-found' })
})

test('keeps the renderer data services in sync with the Worker', async ({ page, account }) => {
  await gotoBridge(page, account)
  const result = await page.evaluate(async () => {
    const changed: string[] = []
    bridge.api.dataApi.onDataChanged((effects) => changed.push(...effects.map((effect) => effect.endpoint)))
    // Main notifies a window only about the keys it subscribed to.
    const preferenceChanges: [string, unknown][] = []
    bridge.api.preference.onChanged((key, value) => preferenceChanges.push([key, value]))
    await bridge.api.preference.subscribe(['app.developer_mode.enabled'])

    await bridge.dataApiService.post('/topics', { body: { name: 'From the page' } })
    await bridge.preferenceService.set('app.developer_mode.enabled', true)
    bridge.cacheService.setShared('network.online', false)
    await new Promise((resolve) => setTimeout(resolve, 200))
    return { changed, preferenceChanges, shared: (await bridge.api.cache.getAllShared())['network.online'] }
  })
  expect(result.changed).toContain('/topics')
  expect(result.preferenceChanges).toContainEqual(['app.developer_mode.enabled', true])
  expect(result.shared).toMatchObject({ value: false })

  await page.reload()
  await gotoBridge(page, account)
  expect(await page.evaluate(() => bridge.preferenceService.get('app.developer_mode.enabled'))).toBe(true)
})

test('streams a reply to the page through the renderer chat transport', async ({ page, account }) => {
  await gotoBridge(page, account)
  const result = await page.evaluate(async (baseUrl) => {
    const { dataApiService } = bridge
    const providerId = `mock-${crypto.randomUUID().slice(0, 8)}`
    await dataApiService.post('/providers', {
      body: {
        providerId,
        name: 'Mock provider',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: { 'openai-chat-completions': { baseUrl: `${baseUrl}/v1` } },
        apiKeys: [{ id: crypto.randomUUID(), key: 'sk-web-trial', isEnabled: true }]
      }
    })
    await dataApiService.post('/models', {
      body: [{ providerId, modelId: 'mock-chat', name: 'Mock chat', endpointTypes: ['openai-chat-completions'] }]
    })
    const assistant = await dataApiService.post('/assistants', {
      body: { name: 'Web trial', modelId: `${providerId}::mock-chat` }
    })
    const topic = await dataApiService.post('/topics', { body: { name: 'Web chat', assistantId: assistant.id } })

    // The desktop chat view renders each model's reply from these events (`executionStreamOverlayService`).
    const deltas: string[] = []
    bridge.ipcApi.on('ai.stream.chunk', ({ topicId, chunk }) => {
      if (topicId === topic.id && chunk.type === 'text-delta') deltas.push(chunk.delta)
    })
    const stream = await bridge.ipcChatTransport.sendMessages({
      trigger: 'submit-message',
      chatId: topic.id,
      messageId: undefined,
      messages: [{ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'hello from the page' }] }],
      abortSignal: undefined
    })
    // The topic stream closes when the Worker reports the turn done.
    await stream.pipeTo(new WritableStream())

    const branch = await dataApiService.get(`/topics/${topic.id}/messages`, { query: { limit: 50 } })
    return {
      deltas,
      persisted: branch.items.map(({ message }: { message: { role: string; status: string } }) => [
        message.role,
        message.status
      ]),
      streamStatus: bridge.cacheService.getShared(`topic.stream.statuses.${topic.id}`)
    }
  }, MOCK_PROVIDER)

  expect(result.deltas.join('')).toBe('echo: hello from the page')
  expect(result.persisted).toEqual([
    ['user', 'success'],
    ['assistant', 'success']
  ])
  // Written by the Worker's stream manager, so it reached the page through the shared-cache relay.
  expect(result.streamStatus).toBeTruthy()
})
