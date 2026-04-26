import type { GatewayLanguageModelEntry } from '@ai-sdk/gateway'
import type { Provider } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAvailableModels = vi.fn()
const mockCreateGateway = vi.fn()

vi.mock('ai', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    createGateway: (opts: any) => {
      mockCreateGateway(opts)
      return { getAvailableModels: mockGetAvailableModels }
    }
  }
})

vi.mock('@renderer/aiCore/provider/providerConfig', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    adaptProvider: ({ provider }: { provider: Provider }) => provider,
    providerToAiSdkConfig: vi.fn()
  }
})

const makeGatewayProvider = (apiKey: string): Provider =>
  ({
    id: SystemProviderIds.gateway,
    name: 'Vercel AI Gateway',
    type: 'gateway',
    apiKey,
    apiHost: 'https://ai-gateway.vercel.sh/v1/ai',
    models: [],
    isSystem: true,
    enabled: true
  }) as unknown as Provider

describe('AiProvider.models() — gateway provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the configured apiKey to createGateway', async () => {
    const { default: AiProvider } = await import('@renderer/aiCore/AiProvider')

    mockGetAvailableModels.mockResolvedValue({ models: [] })

    const provider = makeGatewayProvider('my-real-api-key')
    const ai = new AiProvider(provider)
    await ai.models()

    expect(mockCreateGateway).toHaveBeenCalledWith({ apiKey: 'my-real-api-key' })
  })

  it('returns normalized models on success', async () => {
    const { default: AiProvider } = await import('@renderer/aiCore/AiProvider')

    const fakeEntries: GatewayLanguageModelEntry[] = [
      { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'OpenAI GPT-4o' } as GatewayLanguageModelEntry,
      { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' } as GatewayLanguageModelEntry
    ]
    mockGetAvailableModels.mockResolvedValue({ models: fakeEntries })

    const provider = makeGatewayProvider('valid-key')
    const ai = new AiProvider(provider)
    const models = await ai.models()

    expect(models).toHaveLength(2)
    expect(models[0].id).toBe('openai/gpt-4o')
    expect(models[0].provider).toBe(SystemProviderIds.gateway)
    expect(models[1].id).toBe('anthropic/claude-3-5-sonnet')
  })

  it('propagates error when getAvailableModels fails', async () => {
    const { default: AiProvider } = await import('@renderer/aiCore/AiProvider')

    mockGetAvailableModels.mockRejectedValue(new Error('401 Invalid Token'))

    const provider = makeGatewayProvider('bad-key')
    const ai = new AiProvider(provider)

    await expect(ai.models()).rejects.toThrow('401 Invalid Token')
  })
})
