import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, streamText } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRetryableWrap } from '@main/ai/runtime/aiSdk/retry/createRetryableWrap'
import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

const mocks = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
  getApiOrigin: vi.fn(),
  syncEntitledModelsIfStale: vi.fn()
}))

vi.mock('@application', async () =>
  (await import('@test-mocks/main/application')).mockApplicationFactory({ CherryCloudService: mocks } as never)
)

const { buildCherryCloudProviderConfig, ModelUnavailableError } = await import('../cherryCloud')

const MODEL_ID = `${CHERRY_CLOUD_PROVIDER_ID}::cloud-model` as const

describe('Cherry Cloud provider transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getApiOrigin.mockReturnValue('https://cloud.cherryai.com.cn')
    mocks.authenticatedFetch.mockResolvedValue(new Response('{}', { status: 200 }))
    mocks.syncEntitledModelsIfStale.mockResolvedValue({
      entitledModelIds: [MODEL_ID],
      freeModelIds: [MODEL_ID],
      availableModelIds: { agent: [MODEL_ID], general: [MODEL_ID] },
      quotaExhaustedModelIds: []
    })
  })

  it.each([
    {
      endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      providerId: 'anthropic',
      path: '/v1/messages'
    },
    {
      endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      providerId: 'openai-compatible',
      path: '/v1/chat/completions'
    }
  ])('routes $endpointType through $path and strips caller credentials', async ({ endpointType, providerId, path }) => {
    const config = buildCherryCloudProviderConfig(endpointType, 'messages', MODEL_ID)
    const settings = config.providerSettings as {
      apiKey?: string
      baseURL?: string
      fetch?: typeof globalThis.fetch
      includeUsage?: boolean
      name?: string
    }
    const controller = new AbortController()

    expect(config.providerId).toBe(providerId)
    expect(config.endpoint).toBe('messages')
    expect(settings.baseURL).toBe('https://cloud.cherryai.com.cn/v1')
    expect(settings.apiKey).toBeTruthy()
    if (endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) {
      expect(settings.name).toBe(CHERRY_CLOUD_PROVIDER_ID)
      expect(settings.includeUsage).toBe(true)
    }

    const response = await settings.fetch!(new URL(`https://cloud.cherryai.com.cn${path}?beta=true`), {
      method: 'POST',
      headers: {
        Authorization: 'Bearer caller-token',
        'Content-Encoding': 'gzip',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'request-1',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'anthropic-version': '2023-06-01',
        'sec-fetch-mode': 'cors',
        'x-api-key': 'sdk-placeholder',
        'x-cherry-agent-session-id': 'agent-session',
        'x-cherry-internal-usage-token': 'usage-token'
      },
      body: '{"model":"claude"}',
      signal: controller.signal
    })

    expect(response.status).toBe(200)
    expect(mocks.authenticatedFetch).toHaveBeenCalledOnce()
    const [requestPath, init] = mocks.authenticatedFetch.mock.calls[0]
    const headers = new Headers(init.headers)
    expect(requestPath).toBe(`${path}?beta=true`)
    expect(init).toMatchObject({ method: 'POST', body: '{"model":"claude"}' })
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('idempotency-key')).toBe('request-1')
    expect(headers.get('anthropic-beta')).toBe('prompt-caching-2024-07-31')
    expect(headers.get('anthropic-version')).toBe('2023-06-01')
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('content-encoding')).toBeNull()
    expect(headers.get('sec-fetch-mode')).toBeNull()
    expect(headers.get('x-api-key')).toBeNull()
    expect(headers.get('x-cherry-agent-session-id')).toBeNull()
    expect(headers.get('x-cherry-internal-usage-token')).toBeNull()

    controller.abort()
    expect(init.signal?.aborted).toBe(true)
  })

  it.each([
    [ENDPOINT_TYPE.ANTHROPIC_MESSAGES, '/v1/chat/completions'],
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, '/v1/messages']
  ])('rejects requests outside the configured %s route', async (endpointType, mismatchedPath) => {
    const config = buildCherryCloudProviderConfig(endpointType, undefined, MODEL_ID)
    const fetch = config.providerSettings.fetch!

    await expect(fetch(`https://example.com${mismatchedPath}`, { method: 'POST', body: '{}' })).rejects.toThrow(
      'configured Cherry Cloud API origin'
    )
    await expect(
      fetch(`https://cloud.cherryai.com.cn${mismatchedPath}`, { method: 'POST', body: '{}' })
    ).rejects.toThrow('configured Cherry Cloud API origin')
    expect(mocks.authenticatedFetch).not.toHaveBeenCalled()
  })

  it('rejects models outside the current entitlement before sending a provider request', async () => {
    mocks.syncEntitledModelsIfStale.mockResolvedValueOnce({
      entitledModelIds: [],
      freeModelIds: [],
      availableModelIds: { agent: [], general: [] },
      quotaExhaustedModelIds: []
    })

    const config = buildCherryCloudProviderConfig(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, undefined, MODEL_ID)
    await expect(
      config.providerSettings.fetch!('https://cloud.cherryai.com.cn/v1/chat/completions', {
        method: 'POST',
        body: '{}'
      })
    ).rejects.toBeInstanceOf(ModelUnavailableError)
    expect(mocks.authenticatedFetch).not.toHaveBeenCalled()
  })

  it('rejects quota-exhausted models before sending a provider request', async () => {
    mocks.syncEntitledModelsIfStale.mockResolvedValueOnce({
      entitledModelIds: [MODEL_ID],
      freeModelIds: [MODEL_ID],
      availableModelIds: { agent: [], general: [MODEL_ID] },
      quotaExhaustedModelIds: [MODEL_ID]
    })

    const config = buildCherryCloudProviderConfig(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, undefined, MODEL_ID)
    await expect(
      config.providerSettings.fetch!('https://cloud.cherryai.com.cn/v1/chat/completions', {
        method: 'POST',
        body: '{}'
      })
    ).rejects.toBeInstanceOf(ModelUnavailableError)
  })

  it('fails closed when model availability cannot be refreshed', async () => {
    const cause = new Error('cloud unavailable')
    mocks.syncEntitledModelsIfStale.mockRejectedValueOnce(cause)

    const config = buildCherryCloudProviderConfig(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, undefined, MODEL_ID)
    await expect(
      config.providerSettings.fetch!('https://cloud.cherryai.com.cn/v1/chat/completions', {
        method: 'POST',
        body: '{}'
      })
    ).rejects.toMatchObject({ name: 'ModelUnavailableError', cause })
  })
  it.each(['generate', 'stream'] as const)(
    'uses a configured fallback after cloud admission fails during %s',
    async (mode) => {
      mocks.syncEntitledModelsIfStale.mockResolvedValue({
        entitledModelIds: [MODEL_ID],
        freeModelIds: [],
        availableModelIds: { agent: [], general: [MODEL_ID] },
        quotaExhaustedModelIds: [MODEL_ID]
      })
      const config = buildCherryCloudProviderConfig(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, undefined, MODEL_ID)
      const primary = createOpenAICompatible({
        name: 'cloud',
        baseURL: 'https://cloud.cherryai.com.cn/v1',
        fetch: config.providerSettings.fetch
      }).chatModel('cloud-model')
      const fallback = createOpenAICompatible({
        name: 'fallback',
        baseURL: 'https://fallback.example/v1',
        fetch: async () =>
          mode === 'generate'
            ? Response.json({
                id: 'reply',
                object: 'chat.completion',
                created: 1,
                model: 'fallback',
                choices: [{ index: 0, message: { role: 'assistant', content: 'Recovered' }, finish_reason: 'stop' }]
              })
            : new Response(
                'data: ' +
                  JSON.stringify({
                    id: 'reply',
                    object: 'chat.completion.chunk',
                    created: 1,
                    model: 'fallback',
                    choices: [{ index: 0, delta: { content: 'Recovered' }, finish_reason: null }]
                  }) +
                  '\n\ndata: [DONE]\n\n',
                { headers: { 'content-type': 'text/event-stream' } }
              )
      }).chatModel('fallback')
      const wrap = createRetryableWrap({
        retryPolicy: { enabled: true, maxAttempts: 1, backoffEnabled: false, fallbackModelIds: [] },
        fallbacks: [async () => ({ model: fallback })]
      })!
      const model = wrap(primary)
      const result =
        mode === 'generate'
          ? await generateText({ model, prompt: 'hello', maxRetries: 0 })
          : streamText({ model, prompt: 'hello', maxRetries: 0 })
      expect(await result.text).toBe('Recovered')
      expect(mocks.authenticatedFetch).not.toHaveBeenCalled()
    }
  )
})
