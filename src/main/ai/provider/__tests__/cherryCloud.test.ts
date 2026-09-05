import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
  getApiOrigin: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'CherryCloudService') return mocks
      throw new Error(`Unexpected service: ${name}`)
    }
  }
}))

const { buildCherryCloudProviderConfig } = await import('../cherryCloud')

describe('Cherry Cloud provider transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getApiOrigin.mockReturnValue('https://cloud.cherryai.com.cn')
    mocks.authenticatedFetch.mockResolvedValue(new Response('{}', { status: 200 }))
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
    const config = buildCherryCloudProviderConfig(endpointType, 'messages')
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
    const config = buildCherryCloudProviderConfig(endpointType)
    const fetch = (config.providerSettings as { fetch?: typeof globalThis.fetch }).fetch!

    await expect(fetch(`https://example.com${mismatchedPath}`, { method: 'POST', body: '{}' })).rejects.toThrow(
      'configured Cherry Cloud API origin'
    )
    await expect(
      fetch(`https://cloud.cherryai.com.cn${mismatchedPath}`, { method: 'POST', body: '{}' })
    ).rejects.toThrow('configured Cherry Cloud API origin')
    expect(mocks.authenticatedFetch).not.toHaveBeenCalled()
  })
})
