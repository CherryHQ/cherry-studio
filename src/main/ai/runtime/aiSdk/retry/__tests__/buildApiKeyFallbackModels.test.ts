import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel, makeProvider } from '../../../../__tests__/fixtures'

const resolveLanguageModel = vi.fn()
vi.mock('@cherrystudio/ai-core', () => ({
  resolveLanguageModel: (...args: unknown[]) => resolveLanguageModel(...args)
}))

const buildAgentParams = vi.fn()
vi.mock('../../params/buildAgentParams', () => ({
  buildAgentParams: (...args: unknown[]) => buildAgentParams(...args)
}))

const getApiKeys = vi.fn()
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getApiKeys: (...args: unknown[]) => getApiKeys(...args) }
}))

const { buildApiKeyFallbackModels } = await import('../buildApiKeyFallbackModels')

describe('buildApiKeyFallbackModels', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds the next enabled key lazily with its own usage attribution', async () => {
    const provider = makeProvider({ id: 'provider' })
    getApiKeys.mockReturnValue([
      { id: 'key-1', key: 'sk-1', isEnabled: true },
      { id: 'disabled', key: 'sk-disabled', isEnabled: false },
      { id: 'key-2', key: 'sk-2', isEnabled: true },
      { id: 'key-3', key: 'sk-3', isEnabled: true }
    ])
    const model = makeModel({ id: 'provider::model', providerId: 'provider', apiModelId: 'model' })
    const fallbackReceipt = { attribution: 'matched' as const, id: 'key-3', masked: 'sk-3****3333' }
    const featurePlugin = { name: 'feature' }
    const usagePlugin = { name: 'usage-key-3' }
    const repairToolCall = vi.fn()
    const createUsagePlugin = vi.fn().mockReturnValue(usagePlugin)
    buildAgentParams.mockResolvedValue({
      sdkConfig: { providerId: 'openai', providerSettings: { apiKey: 'sk-3' }, modelId: 'model' },
      credentialReceipt: fallbackReceipt,
      plugins: [featurePlugin],
      options: { repairToolCall }
    })
    const resolvedModel = { modelId: 'model' }
    resolveLanguageModel.mockResolvedValue(resolvedModel)

    const fallbacks = buildApiKeyFallbackModels({
      request: { uniqueModelId: 'provider::model' } as never,
      provider,
      model,
      assistant: undefined,
      signal: undefined,
      extraFeatures: [],
      primaryCredentialReceipt: { attribution: 'explicit', id: 'key-2', masked: 'sk-2****2222' },
      createUsagePlugin
    })

    expect(fallbacks).toHaveLength(2)
    expect(buildAgentParams).not.toHaveBeenCalled()

    await expect(fallbacks[0]()).resolves.toEqual({ model: resolvedModel, repairToolCall })
    expect(buildAgentParams).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ apiKeyOverride: 'sk-3' }) })
    )
    expect(createUsagePlugin).toHaveBeenCalledWith(fallbackReceipt)
    expect(resolveLanguageModel).toHaveBeenCalledWith('openai', { apiKey: 'sk-3' }, 'model', [
      featurePlugin,
      usagePlugin
    ])
  })

  it('does not read the key pool for an override or an unknown serving credential', () => {
    const provider = makeProvider({ id: 'provider' })
    const model = makeModel({ id: 'provider::model', providerId: 'provider', apiModelId: 'model' })
    const common = {
      provider,
      model,
      assistant: undefined,
      signal: undefined,
      extraFeatures: [],
      createUsagePlugin: vi.fn()
    }

    expect(
      buildApiKeyFallbackModels({
        ...common,
        request: { uniqueModelId: 'provider::model', apiKeyOverride: 'sk-override' } as never,
        primaryCredentialReceipt: { attribution: 'matched', id: 'key-1', masked: 'sk-1****1111' }
      })
    ).toEqual([])
    expect(
      buildApiKeyFallbackModels({
        ...common,
        request: { uniqueModelId: 'provider::model' } as never,
        primaryCredentialReceipt: { attribution: 'unknown' }
      })
    ).toEqual([])
    expect(getApiKeys).not.toHaveBeenCalled()
  })

  describe('per-model key binding', () => {
    const provider = makeProvider({ id: 'provider' })
    const keys = [
      { id: 'key-a', key: 'sk-a', isEnabled: true },
      { id: 'key-b', key: 'sk-b', isEnabled: true }
    ]
    const build = (apiKeyId: string | null | undefined) =>
      buildApiKeyFallbackModels({
        request: { uniqueModelId: 'provider::model' } as never,
        provider,
        model: makeModel({ id: 'provider::model', providerId: 'provider', apiModelId: 'model', apiKeyId }),
        assistant: undefined,
        signal: undefined,
        extraFeatures: [],
        primaryCredentialReceipt: { attribution: 'explicit', id: 'key-b', masked: 'sk-b****' },
        createUsagePlugin: vi.fn()
      })

    it('never fails a model bound to an enabled key over to another account', () => {
      getApiKeys.mockReturnValue(keys)
      expect(build('key-b')).toEqual([])
    })

    it('keeps automatic failover when the binding is missing or disabled', () => {
      getApiKeys.mockReturnValue([...keys, { id: 'key-off', key: 'sk-off', isEnabled: false }])
      expect(build('key-gone')).toHaveLength(1)
      expect(build('key-off')).toHaveLength(1)
      expect(build(null)).toHaveLength(1)
    })
  })
})
