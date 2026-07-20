import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InputParamsMap } from '../../adapters'

type GeminiGenerateContentRequest = InputParamsMap['gemini']

const mocks = vi.hoisted(() => ({ countTokens: vi.fn(), providerToAiSdkConfig: vi.fn(), clientOptions: vi.fn() }))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { countTokens: mocks.countTokens }
    constructor(opts: unknown) {
      mocks.clientOptions(opts)
    }
  }
}))
vi.mock('@main/ai/provider/config', () => ({ providerToAiSdkConfig: mocks.providerToAiSdkConfig }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

import { tryRemoteGeminiCount } from '../remoteGeminiCount'

const body = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] } as unknown as GeminiGenerateContentRequest
const provider = { id: 'p' } as Provider
const model = {} as Model

beforeEach(() => vi.clearAllMocks())

describe('tryRemoteGeminiCount', () => {
  it('returns the provider totalTokens', async () => {
    mocks.providerToAiSdkConfig.mockResolvedValue({ providerSettings: { baseURL: 'https://x/v1beta', apiKey: 'k' } })
    mocks.countTokens.mockResolvedValue({ totalTokens: 42 })
    expect(await tryRemoteGeminiCount(body, provider, model, 'gemini-2.0')).toBe(42)
    expect(mocks.countTokens).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-2.0' }))
    // Hot path: fail fast to the local fallback — the client must carry an explicit timeout.
    expect(mocks.clientOptions).toHaveBeenCalledWith(
      expect.objectContaining({ httpOptions: { timeout: 5_000, baseUrl: 'https://x' } })
    )
  })

  it('returns undefined (→ local fallback) when the api key is missing', async () => {
    mocks.providerToAiSdkConfig.mockResolvedValue({ providerSettings: { baseURL: 'https://x/v1beta' } })
    expect(await tryRemoteGeminiCount(body, provider, model, 'gemini-2.0')).toBeUndefined()
    expect(mocks.countTokens).not.toHaveBeenCalled()
  })

  it('returns undefined when the remote call throws', async () => {
    mocks.providerToAiSdkConfig.mockResolvedValue({ providerSettings: { baseURL: 'https://x/v1beta', apiKey: 'k' } })
    mocks.countTokens.mockRejectedValue(new Error('boom'))
    expect(await tryRemoteGeminiCount(body, provider, model, 'gemini-2.0')).toBeUndefined()
  })
})
