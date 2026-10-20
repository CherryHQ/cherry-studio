import type { Page } from '@playwright/test'

import type { Assistant } from '@shared/data/types/assistant'
import type { BranchMessagesResponse, Message } from '@shared/data/types/message'
import type { Topic } from '@shared/data/types/topic'

import { expect, reloadHarness, test } from './fixtures'
import { MOCK_PROVIDER_PORT } from './mockProvider'

const MOCK_PROVIDER = `http://localhost:${MOCK_PROVIDER_PORT}`

const textOf = (message: Message) =>
  (message.data.parts ?? []).map((part) => ('text' in part ? part.text : '')).join('')

interface ChatResult {
  admission: { mode: string }
  status: string
  error?: string
  deltas: string[]
}

/** A provider pointing at the mock endpoint, a model on it, an assistant using it and an empty topic. */
async function createChatSetup(page: Page) {
  return page.evaluate(async (baseUrl) => {
    const { client } = harness
    const providerId = `mock-${crypto.randomUUID().slice(0, 8)}`
    const provider = await client.request('POST', '/providers', {
      body: {
        providerId,
        name: 'Mock provider',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: { 'openai-chat-completions': { baseUrl: `${baseUrl}/v1` } },
        apiKeys: [{ id: crypto.randomUUID(), key: 'sk-web-trial', isEnabled: true }]
      }
    })
    if (provider.error) throw new Error(`create provider: ${provider.error.message}`)
    const models = await client.request('POST', '/models', {
      body: [{ providerId, modelId: 'mock-chat', name: 'Mock chat', endpointTypes: ['openai-chat-completions'] }]
    })
    if (models.error) throw new Error(`create model: ${models.error.message}`)
    const assistant = await client.request<Assistant>('POST', '/assistants', {
      body: { name: 'Web trial', modelId: `${providerId}::mock-chat` }
    })
    if (assistant.error) throw new Error(`create assistant: ${assistant.error.message}`)
    const topic = await client.request<Topic>('POST', '/topics', {
      body: { name: 'Web chat', assistantId: assistant.data!.id }
    })
    if (topic.error) throw new Error(`create topic: ${topic.error.message}`)
    return { topicId: topic.data!.id }
  }, MOCK_PROVIDER)
}

function chat(page: Page, topicId: string, text: string, parentAnchorId?: string) {
  return page.evaluate(
    ({ topicId, text, parentAnchorId }) => harness.client.send<ChatResult>('chat', { topicId, text, parentAnchorId }),
    { topicId, text, parentAnchorId }
  )
}

function readBranch(page: Page, topicId: string) {
  return page.evaluate(async (topicId) => {
    const response = await harness.client.request<BranchMessagesResponse>('GET', `/topics/${topicId}/messages`, {
      params: { limit: 50 }
    })
    if (response.error) throw new Error(response.error.message)
    return response.data!.items.map(({ message }) => message)
  }, topicId)
}

async function receivedByMock(): Promise<{ authorization?: string; body: { messages: { role: string }[] } }[]> {
  return (await fetch(`${MOCK_PROVIDER}/requests`)).json()
}

test('streams a chat reply from an OpenAI-compatible provider and keeps it across a reload', async ({
  page,
  account
}) => {
  await page.evaluate((account) => harness.client.open(account), account)
  const { topicId } = await createChatSetup(page)

  const first = await chat(page, topicId, 'hello from the browser')
  expect(first).toMatchObject({ admission: { mode: 'started' }, status: 'success' })
  expect(first.deltas.join('')).toBe('echo: hello from the browser')
  expect(first.deltas.length).toBeGreaterThan(1)

  const afterFirst = await readBranch(page, topicId)
  expect(afterFirst.map((message) => [message.role, message.status, textOf(message)])).toEqual([
    ['user', 'success', 'hello from the browser'],
    ['assistant', 'success', 'echo: hello from the browser']
  ])

  const second = await chat(page, topicId, 'second turn', afterFirst.at(-1)!.id)
  expect(second.status).toBe('success')
  const sent = (await receivedByMock()).findLast((request) =>
    JSON.stringify(request.body.messages).includes('second turn')
  )!
  expect(sent.authorization).toBe('Bearer sk-web-trial')
  expect(sent.body.messages.filter((message) => message.role !== 'system').map((message) => message.role)).toEqual([
    'user',
    'assistant',
    'user'
  ])

  await reloadHarness(page)
  await page.evaluate((account) => harness.client.open(account), account)
  expect((await readBranch(page, topicId)).map(textOf)).toEqual([
    'hello from the browser',
    'echo: hello from the browser',
    'second turn',
    'echo: second turn'
  ])
})

test('persists a provider error on the reply instead of leaving it pending', async ({ page, account }) => {
  await page.evaluate((account) => harness.client.open(account), account)
  const { topicId } = await createChatSetup(page)

  const result = await chat(page, topicId, 'please fail')
  expect(result.status).toBe('error')
  expect(result.error).toContain('mock provider rejected the key')

  const [user, reply] = await readBranch(page, topicId)
  expect(user.status).toBe('success')
  expect(reply).toMatchObject({ role: 'assistant', status: 'error' })
})

test('marks a reply left streaming by a closed tab as failed when the account reopens', async ({ page, account }) => {
  await page.evaluate((account) => harness.client.open(account), account)
  const { topicId } = await createChatSetup(page)

  void chat(page, topicId, 'please hang').catch(() => {})
  await expect
    .poll(async () => (await readBranch(page, topicId)).map((message) => [message.role, message.status]))
    .toEqual([
      ['user', 'success'],
      ['assistant', 'pending']
    ])

  await reloadHarness(page)
  await page.evaluate((account) => harness.client.open(account), account)
  const [, reply] = await readBranch(page, topicId)
  expect(reply.status).toBe('error')
})
