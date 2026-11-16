import '@data/services/ProviderRegistryService'
import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { AiService } from '../AiService'
import type * as CustomFetchModule from '../utils/customFetch'

const { transport } = vi.hoisted(() => ({ transport: vi.fn<typeof fetch>() }))
vi.mock('../utils/customFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof CustomFetchModule>()),
  customFetch: transport
}))

const request = {
  uniqueModelId: 'model-check::responses' as const,
  apiKeyOverride: 'selected-key',
  requestOptions: { maxRetries: 0 }
}
const message = {
  type: 'message',
  id: 'message-check',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text: 'ok', annotations: [] }]
}
const started = { type: 'response.created', response: { id: 'response-check', model: 'responses' } }
const partial = [
  started,
  { type: 'response.output_item.added', output_index: 0, item: { ...message, content: [] } },
  { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: 'ok' }
]

function sse(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' }
  })
}

describe('model checks through AiService and the real SDK', () => {
  const dbh = setupTestDatabase()
  let service: AiService

  beforeEach(() => {
    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      key === 'feature.provider_registry.data'
        ? resolve('packages/provider-registry/data', filename ?? '')
        : getPath(key, filename)
    )
    transport.mockReset()
    MockMainPreferenceServiceUtils.resetMocks()
    BaseService.resetInstances()
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'model-check',
        name: 'Model check',
        orderKey: 'a0',
        isEnabled: true,
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://model-check.test/v1' },
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://model-check.test/v1' }
        }
      })
      .run()
    for (const [modelId, endpointType] of [
      ['responses', ENDPOINT_TYPE.OPENAI_RESPONSES],
      ['chat', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    ] as const) {
      dbh.db
        .insert(userModelTable)
        .values({
          id: `model-check::${modelId}`,
          providerId: 'model-check',
          modelId,
          name: modelId,
          endpointTypes: [endpointType],
          capabilities: [],
          supportsStreaming: true,
          isEnabled: true,
          orderKey: modelId === 'responses' ? 'a0' : 'a1'
        })
        .run()
    }
    service = new (AiService as unknown as new () => AiService)()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('accepts a stream-only Responses endpoint using the selected credential', async () => {
    transport.mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://model-check.test/v1/responses')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer selected-key')
      const body = JSON.parse(String(init?.body))
      if (body.stream !== true) {
        return Response.json({ error: { message: 'stream must be true' } }, { status: 400 })
      }
      expect(body.model).toBe('responses')
      expect(JSON.stringify(body.input)).toContain('hi')
      return sse([
        ...partial,
        { type: 'response.output_item.done', output_index: 0, item: message },
        {
          type: 'response.completed',
          response: {
            id: 'response-check',
            model: 'responses',
            status: 'completed',
            output: [message],
            usage: { input_tokens: 1, output_tokens: 1 }
          }
        }
      ])
    })

    const result = await service.checkModel(request)
    expect(result.latency).toBeGreaterThanOrEqual(0)
  })

  it.each([400, 401])('rejects an HTTP %i response', async (status) => {
    transport.mockResolvedValue(Response.json({ error: { message: 'probe rejected' } }, { status }))
    await expect(service.checkModel(request)).rejects.toMatchObject({ statusCode: status, message: 'probe rejected' })
  })

  it('rejects a provider failure after partial text instead of accepting the first token', async () => {
    transport.mockResolvedValue(
      sse([
        ...partial,
        {
          type: 'response.failed',
          response: { error: { code: 429, message: 'provider concurrency limit reached' } }
        }
      ])
    )
    await expect(service.checkModel(request)).rejects.toThrow('provider concurrency limit reached')
  })

  it.each([
    { label: 'created event', events: [started] },
    { label: 'partial text', events: partial }
  ])('rejects a stream truncated after $label without completion', async ({ events }) => {
    transport.mockResolvedValue(sse(events))
    await expect(service.checkModel(request)).rejects.toThrow(/finish|incomplete|ended/i)
  })

  it.each(['timeout', 'caller abort'] as const)('cancels an unfinished HTTP stream on %s', async (reason) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const opened = Promise.withResolvers<AbortSignal>()
    transport.mockImplementation(async (_url, init) => {
      const signal = init!.signal!
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(started)}\n\n`))
            opened.resolve(signal)
          }
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    })
    const controller = new AbortController()
    const check = service.checkModel({
      ...request,
      requestOptions: { ...request.requestOptions, signal: controller.signal }
    })
    const rejected = expect(check).rejects.toThrow(reason === 'timeout' ? 'Check model timeout' : 'probe cancelled')
    const signal = await opened.promise
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(15_000)
    else controller.abort(new Error('probe cancelled'))
    await rejected
    expect(signal.aborted).toBe(true)
  })

  it('keeps Chat Completions checks non-streaming', async () => {
    transport.mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://model-check.test/v1/chat/completions')
      const body = JSON.parse(String(init?.body))
      expect(body.stream).not.toBe(true)
      expect(body.model).toBe('chat')
      return Response.json({
        id: 'check-chat',
        object: 'chat.completion',
        created: 1,
        model: 'chat',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })
    })
    const result = await service.checkModel({ ...request, uniqueModelId: 'model-check::chat' })
    expect(result.latency).toBeGreaterThanOrEqual(0)
  })
})
