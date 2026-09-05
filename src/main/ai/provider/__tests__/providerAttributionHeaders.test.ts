import { createExecutor } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'

const { resolveApiKeyMock, getAuthConfigMock, getByProviderIdMock, isRegistryProviderMock } = vi.hoisted(() => ({
  resolveApiKeyMock: vi.fn(),
  getAuthConfigMock: vi.fn(),
  getByProviderIdMock: vi.fn(),
  isRegistryProviderMock: vi.fn<(providerId: string) => boolean>()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    resolveApiKey: resolveApiKeyMock,
    getAuthConfig: getAuthConfigMock,
    getByProviderId: getByProviderIdMock
  }
}))

vi.mock('@main/data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    isRegistryProvider: isRegistryProviderMock
  }
}))

const { providerToAiSdkConfig } = await import('../config')

beforeEach(() => {
  vi.clearAllMocks()
  resolveApiKeyMock.mockReturnValue({
    value: 'sk-tokenrhythm',
    apiKeySelection: { attribution: 'explicit', id: 'test-key', masked: 'sk-t****ythm' }
  })
  getAuthConfigMock.mockReturnValue(null)
  isRegistryProviderMock.mockImplementation((providerId) => providerId === 'openai' || providerId === 'zai')
})

function makeOpenAICompatibleProvider(overrides: Partial<Provider> = {}): Provider {
  return makeProvider({
    id: 'custom-tokenrhythm',
    presetProviderId: 'openai',
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
        baseUrl: 'https://tokenrhythm.studio/v1',
        adapterFamily: 'openai-compatible'
      }
    },
    ...overrides
  })
}

function fakeSuccessResponse(): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-fake',
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

async function captureRequestHeaders(provider: Provider): Promise<Headers> {
  const model = makeModel({
    providerId: provider.id,
    apiModelId: 'deepseek-v4-flash',
    endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
  })
  const config = await providerToAiSdkConfig(provider, model)
  const fetchSpy = vi.fn().mockResolvedValue(fakeSuccessResponse())
  const executor = await createExecutor(
    config.providerId as Parameters<typeof createExecutor>[0],
    { ...config.providerSettings, fetch: fetchSpy } as Parameters<typeof createExecutor>[1]
  )
  const languageModel = await executor.languageModel(model.apiModelId ?? model.id)

  await languageModel.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]
  })

  const init = fetchSpy.mock.calls[0][1] as RequestInit
  return new Headers(init.headers)
}

describe('provider attribution headers on the chat request boundary', () => {
  it('omits automatic attribution for a custom preset clone while preserving auth and user headers', async () => {
    const headers = await captureRequestHeaders(
      makeOpenAICompatibleProvider({ settings: { extraHeaders: { 'X-Custom': 'keep' } } })
    )

    expect(headers.get('authorization')).toBe('Bearer sk-tokenrhythm')
    expect(headers.get('x-custom')).toBe('keep')
    expect(headers.has('http-referer')).toBe(false)
    expect(headers.has('x-title')).toBe(false)
  })

  it('preserves attribution headers explicitly configured by a custom provider', async () => {
    const headers = await captureRequestHeaders(
      makeOpenAICompatibleProvider({
        settings: {
          extraHeaders: {
            'HTTP-Referer': 'https://custom.example.com',
            'X-Title': 'Custom Client'
          }
        }
      })
    )

    expect(headers.get('http-referer')).toBe('https://custom.example.com')
    expect(headers.get('x-title')).toBe('Custom Client')
  })

  it('keeps default attribution for a canonical registry provider', async () => {
    const headers = await captureRequestHeaders(
      makeOpenAICompatibleProvider({
        id: 'openai',
        presetProviderId: 'openai',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://api.openai.com/v1',
            adapterFamily: 'openai-compatible'
          }
        }
      })
    )

    expect(headers.get('http-referer')).toBe('https://cherry-ai.com')
    expect(headers.get('x-title')).toBe('Cherry Studio')
  })

  it('keeps default attribution for a managed provider outside the registry', async () => {
    const headers = await captureRequestHeaders(
      makeOpenAICompatibleProvider({ id: 'cherryai', presetProviderId: 'cherryai' })
    )

    expect(headers.get('http-referer')).toBe('https://cherry-ai.com')
    expect(headers.get('x-title')).toBe('Cherry Studio')
  })

  it('does not reclassify a fully custom provider when its id matches the registry', async () => {
    const headers = await captureRequestHeaders(
      makeOpenAICompatibleProvider({ id: 'openai', presetProviderId: undefined })
    )

    expect(headers.has('http-referer')).toBe(false)
    expect(headers.has('x-title')).toBe(false)
  })

  it('keeps default attribution for a grouped canonical registry provider', async () => {
    const headers = await captureRequestHeaders(makeOpenAICompatibleProvider({ id: 'zai', presetProviderId: 'zhipu' }))

    expect(headers.get('http-referer')).toBe('https://cherry-ai.com')
    expect(headers.get('x-title')).toBe('Cherry Studio')
  })
})
