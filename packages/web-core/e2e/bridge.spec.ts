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
  // The desktop seeders give a new account one empty topic.
  expect(result.topics).toMatchObject({ items: [{ name: '' }] })
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

test("lists a provider's models, checks one and generates text with it", async ({ page, account }) => {
  await gotoBridge(page, account)
  const result = await page.evaluate(async (baseUrl) => {
    const { dataApiService, ipcApi } = bridge
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
    // Model settings fetch the list before any model is added.
    const listed = await ipcApi.request('ai.provider.model.list', { providerId, throwOnError: true })
    await dataApiService.post('/models', {
      body: [{ providerId, modelId: 'mock-chat', name: 'Mock chat', endpointTypes: ['openai-chat-completions'] }]
    })
    const uniqueModelId = `${providerId}::mock-chat`
    const check = await ipcApi.request('ai.provider.model.check', { uniqueModelId, timeout: 15000 })
    // Topic naming and prompt polishing send one-shot requests like this.
    const generated = await ipcApi.request('ai.text.generate', {
      uniqueModelId,
      system: 'Name the topic.',
      prompt: 'say "Web title"'
    })
    return {
      models: listed.models.map(({ apiModelId }: { apiModelId: string }) => apiModelId).sort(),
      latency: typeof check.latency,
      text: generated.text
    }
  }, MOCK_PROVIDER)
  expect(result).toEqual({ models: ['mock-chat', 'mock-other'], latency: 'number', text: 'Web title' })
})

test('translates a message with the translation model', async ({ page, account }) => {
  await gotoBridge(page, account)
  const translation = await page.evaluate(async (baseUrl) => {
    const { dataApiService, ipcApi, preferenceService } = bridge
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
    await preferenceService.set('feature.translate.model_id', `${providerId}::mock-chat`)

    // As the message menu's Translate does (`utils/translate/translateText`).
    const streamId = `translate:${crypto.randomUUID()}`
    let text = ''
    const done = new Promise<void>((resolve, reject) => {
      bridge.ipcApi.on('ai.stream.chunk', ({ topicId, chunk }) => {
        if (topicId === streamId && chunk.type === 'text-delta') text += chunk.delta
      })
      bridge.ipcApi.on('ai.stream.done', ({ topicId }) => topicId === streamId && resolve())
      bridge.ipcApi.on(
        'ai.stream.error',
        ({ topicId, error }) => topicId === streamId && reject(new Error(error.message))
      )
    })
    await ipcApi.request('translate.open', { streamId, text: 'bonjour', targetLangCode: 'en-us' })
    await done
    return text
  }, MOCK_PROVIDER)
  // The mock echoes the translation prompt, which carries the text.
  expect(translation).toMatch(/^echo: [\s\S]*bonjour/)
})

test('creates an agent and gives it a session, as the new-agent dialog does', async ({ page, account }) => {
  await gotoBridge(page, account)
  const result = await page.evaluate(async () => {
    const { dataApiService, ipcApi } = bridge
    const providerId = `mock-${crypto.randomUUID().slice(0, 8)}`
    await dataApiService.post('/providers', {
      body: { providerId, name: 'Mock provider', defaultChatEndpoint: 'openai-chat-completions' }
    })
    await dataApiService.post('/models', {
      body: [{ providerId, modelId: 'mock-chat', name: 'Mock chat', endpointTypes: ['openai-chat-completions'] }]
    })
    const agent = await ipcApi.request('ai.agent.create', {
      type: 'pi',
      name: 'Web agent',
      model: `${providerId}::mock-chat`
    })
    const input = { agentId: agent.id, workspace: { type: 'system' } }
    const first = await ipcApi.request('ai.agent.session.reuse_or_create', input)
    const second = await ipcApi.request('ai.agent.session.reuse_or_create', input)
    return { agentId: agent.id, first, second }
  })
  expect(result.first).toMatchObject({ created: true, session: { agentId: result.agentId } })
  // An agent's empty session is reused rather than duplicated.
  expect(result.second).toMatchObject({ created: false, session: { id: result.first.session.id } })
})

test('archives an agent with its sessions and restores them', async ({ page, account }) => {
  await gotoBridge(page, account)
  const result = await page.evaluate(async () => {
    const { dataApiService, ipcApi } = bridge
    const providerId = `mock-${crypto.randomUUID().slice(0, 8)}`
    await dataApiService.post('/providers', {
      body: { providerId, name: 'Mock provider', defaultChatEndpoint: 'openai-chat-completions' }
    })
    await dataApiService.post('/models', {
      body: [{ providerId, modelId: 'mock-chat', name: 'Mock chat', endpointTypes: ['openai-chat-completions'] }]
    })
    const agent = await ipcApi.request('ai.agent.create', {
      type: 'pi',
      name: 'Web agent',
      model: `${providerId}::mock-chat`
    })
    const { session } = await ipcApi.request('ai.agent.session.reuse_or_create', {
      agentId: agent.id,
      workspace: { type: 'system' }
    })
    const listed = async () => ({
      agent: ((await dataApiService.get('/agents')) as { items: { id: string }[] }).items.some(
        ({ id }) => id === agent.id
      ),
      session: ((await dataApiService.get('/agent-sessions')) as { items: { id: string }[] }).items.some(
        ({ id }) => id === session.id
      )
    })
    const archive = await ipcApi.request('ai.agent.delete', { agentId: agent.id, deleteSessions: true })
    const archived = await listed()
    await ipcApi.request('ai.agent.restore', { agentId: agent.id })
    return { archive, archived, restored: await listed() }
  })
  expect(result.archive.deleted).toBe(true)
  expect(result.archived).toEqual({ agent: false, session: false })
  expect(result.restored).toEqual({ agent: true, session: true })
})

test("deletes a picked folder's workspace with its sessions and keeps the folder's files", async ({
  page,
  account
}) => {
  await gotoBridge(page, account)
  const result = await page.evaluate(async () => {
    const { client, dataApiService, ipcApi } = bridge
    const folder = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle(`picked-${Date.now()}`, {
      create: true
    })
    const writable = await (await folder.getFileHandle('kept.txt', { create: true })).createWritable()
    await writable.write('the user file')
    await writable.close()
    const path = await client.send<string>('local-folder.add', { handle: folder })
    const workspace = await ipcApi.request('ai.agent.workspace.register', { path })

    const providerId = `mock-${crypto.randomUUID().slice(0, 8)}`
    await dataApiService.post('/providers', {
      body: { providerId, name: 'Mock provider', defaultChatEndpoint: 'openai-chat-completions' }
    })
    await dataApiService.post('/models', {
      body: [{ providerId, modelId: 'mock-chat', name: 'Mock chat', endpointTypes: ['openai-chat-completions'] }]
    })
    const agent = await ipcApi.request('ai.agent.create', {
      type: 'pi',
      name: 'Web agent',
      model: `${providerId}::mock-chat`
    })
    const { session } = await ipcApi.request('ai.agent.session.reuse_or_create', {
      agentId: agent.id,
      workspace: { type: 'user', workspaceId: workspace.id }
    })

    const deleted = await ipcApi.request('ai.agent.workspace.delete', { workspaceId: workspace.id })
    const sessions = (await dataApiService.get('/agent-sessions')) as { items: { id: string }[] }
    const workspaces = (await dataApiService.get('/agent-workspaces')) as { id: string }[]
    return {
      deletedIds: deleted.deletedIds,
      sessionId: session.id,
      sessionListed: sessions.items.some(({ id }) => id === session.id),
      workspaceListed: workspaces.some(({ id }) => id === workspace.id),
      file: await (await (await folder.getFileHandle('kept.txt')).getFile()).text()
    }
  })
  expect(result.deletedIds).toEqual([result.sessionId])
  expect(result).toMatchObject({ sessionListed: false, workspaceListed: false, file: 'the user file' })
})

test('archives a chat topic, restores it and empties the archive', async ({ page, account }) => {
  await gotoBridge(page, account)
  const result = await page.evaluate(async () => {
    const { dataApiService, ipcApi } = bridge
    const topic = await dataApiService.post('/topics', { body: { name: 'Archived chat' } })
    const listed = async () =>
      ((await dataApiService.get('/topics', { query: { limit: 50 } })) as { items: { id: string }[] }).items.some(
        ({ id }) => id === topic.id
      )
    await ipcApi.request('trash.topic.archive', { topicIds: [topic.id] })
    const archived = await listed()
    await dataApiService.post(`/topics/${topic.id}/restore`, { body: undefined })
    const restored = await listed()

    await ipcApi.request('trash.topic.archive', { topicIds: [topic.id] })
    const purge = await ipcApi.request('trash.purge_now')
    const restoreAfterPurge = await dataApiService.post(`/topics/${topic.id}/restore`, { body: undefined }).then(
      () => 'restored',
      () => 'gone'
    )
    return { archived, restored, purge, restoreAfterPurge }
  })
  expect(result).toEqual({
    archived: false,
    restored: true,
    purge: { status: 'completed', reclaimed: true, deletedCount: 1, retainedReferencedFileCount: 0 },
    restoreAfterPurge: 'gone'
  })
})
