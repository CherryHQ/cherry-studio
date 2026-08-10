import type { MessageCreateParams } from '@anthropic-ai/sdk/resources'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ countTokens: vi.fn(), providerToAiSdkConfig: vi.fn(), clientOptions: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { countTokens: mocks.countTokens }
    constructor(opts: unknown) {
      mocks.clientOptions(opts)
    }
  }
}))
vi.mock('@main/ai/provider/config', () => ({ providerToAiSdkConfig: mocks.providerToAiSdkConfig }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

import { tryRemoteAnthropicCount } from '../remoteAnthropicCount'

const body = { model: 'p:m', messages: [{ role: 'user', content: 'hi' }] } as unknown as MessageCreateParams
const provider = { id: 'p' } as Provider
const model = {} as Model

beforeEach(() => vi.clearAllMocks())

describe('tryRemoteAnthropicCount', () => {
  it('returns the count, reuses the provider fetch/headers, and passes the abort signal', async () => {
    const fetch = vi.fn()
    const headers = { 'x-relay': '1' }
    mocks.providerToAiSdkConfig.mockResolvedValue({
      providerSettings: { baseURL: 'https://api.x/v1', apiKey: 'k', fetch, headers }
    })
    mocks.countTokens.mockResolvedValue({ input_tokens: 999 })
    const controller = new AbortController()
    expect(await tryRemoteAnthropicCount(body, provider, model, 'claude', controller.signal)).toBe(999)
    // Abort signal reaches the SDK request options.
    expect(mocks.countTokens).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude' }), {
      signal: controller.signal
    })
    // Proxy/signing transport + relay headers are reused, not bypassed; fail-fast on the hot path.
    expect(mocks.clientOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://api.x',
        fetch,
        defaultHeaders: headers,
        timeout: 5_000,
        maxRetries: 0
      })
    )
  })

  it('returns undefined (→ local fallback) when creds are relay-shaped / missing', async () => {
    mocks.providerToAiSdkConfig.mockResolvedValue({ providerSettings: {} })
    expect(await tryRemoteAnthropicCount(body, provider, model, 'claude')).toBeUndefined()
    expect(mocks.countTokens).not.toHaveBeenCalled()
  })

  it('returns undefined when the remote call throws', async () => {
    mocks.providerToAiSdkConfig.mockResolvedValue({ providerSettings: { baseURL: 'https://api.x/v1', apiKey: 'k' } })
    mocks.countTokens.mockRejectedValue(new Error('boom'))
    expect(await tryRemoteAnthropicCount(body, provider, model, 'claude')).toBeUndefined()
  })
})
