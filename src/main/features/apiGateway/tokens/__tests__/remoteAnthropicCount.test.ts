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
  it('returns the provider count and strips the trailing /v1 from the baseURL', async () => {
    mocks.providerToAiSdkConfig.mockResolvedValue({ providerSettings: { baseURL: 'https://api.x/v1', apiKey: 'k' } })
    mocks.countTokens.mockResolvedValue({ input_tokens: 999 })
    expect(await tryRemoteAnthropicCount(body, provider, model, 'claude')).toBe(999)
    expect(mocks.countTokens).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude' }))
    // Hot path: fail fast to the local fallback instead of the SDK's 10-minute default × retries.
    expect(mocks.clientOptions).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.x', timeout: 5_000, maxRetries: 0 })
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
