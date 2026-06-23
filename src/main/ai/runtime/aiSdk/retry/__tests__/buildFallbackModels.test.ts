import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel, makeProvider } from '../../../../__tests__/fixtures'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const getByProviderId = vi.fn()
const getByKey = vi.fn()
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: (...a: unknown[]) => getByProviderId(...a) }
}))
vi.mock('@main/data/services/ModelService', () => ({
  modelService: { getByKey: (...a: unknown[]) => getByKey(...a) }
}))

const resolveLanguageModel = vi.fn()
vi.mock('@cherrystudio/ai-core', () => ({
  resolveLanguageModel: (...a: unknown[]) => resolveLanguageModel(...a)
}))

const buildAgentParams = vi.fn()
vi.mock('../../params/buildAgentParams', () => ({
  buildAgentParams: (...a: unknown[]) => buildAgentParams(...a)
}))

const { buildFallbackModels } = await import('../buildFallbackModels')

const VISION = MODEL_CAPABILITY.IMAGE_RECOGNITION

function setPrefs(fallbackModelIds: string[], enabled = true) {
  MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.enabled' as never, enabled as never)
  MockMainPreferenceServiceUtils.setPreferenceValue('chat.retry.fallback_model_ids' as never, fallbackModelIds as never)
}

/** buildAgentParams stub: returns the fallback model's own plugins + params. */
function stubBuildAgentParams(modelId: string) {
  const plugins = [{ name: `mw-${modelId}` }]
  buildAgentParams.mockResolvedValue({
    sdkConfig: { providerId: 'anthropic', providerSettings: {}, modelId },
    plugins,
    options: { temperature: 0.2, maxOutputTokens: 128 }
  })
  return plugins
}

const baseArgs = {
  request: { messages: [] } as never,
  assistant: undefined,
  signal: undefined,
  primaryHasTools: false,
  requestHasImages: false,
  extraFeatures: []
}

describe('buildFallbackModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    getByProviderId.mockResolvedValue(makeProvider({ id: 'anthropic' }))
    resolveLanguageModel.mockImplementation(async (_pid, _settings, modelId) => ({ modelId, _resolved: true }))
  })

  it('returns [] when retry is disabled', () => {
    setPrefs(['anthropic::claude'], false)
    expect(buildFallbackModels({ ...baseArgs, primaryUniqueModelId: 'openai::gpt-4' })).toEqual([])
  })

  it('is lazy — no provider/model/buildAgentParams work until a resolver is invoked', () => {
    setPrefs(['anthropic::claude'])
    getByKey.mockResolvedValue(makeModel({ id: 'anthropic::claude', providerId: 'anthropic', apiModelId: 'claude-x' }))
    stubBuildAgentParams('claude-x')

    const resolvers = buildFallbackModels({ ...baseArgs, primaryUniqueModelId: 'openai::gpt-4' })

    expect(resolvers).toHaveLength(1)
    expect(getByKey).not.toHaveBeenCalled()
    expect(buildAgentParams).not.toHaveBeenCalled()
    expect(resolveLanguageModel).not.toHaveBeenCalled()
  })

  it('resolves a fallback with its OWN plugins and lifts its OWN param overrides', async () => {
    setPrefs(['anthropic::claude'])
    getByKey.mockResolvedValue(makeModel({ id: 'anthropic::claude', providerId: 'anthropic', apiModelId: 'claude-x' }))
    const plugins = stubBuildAgentParams('claude-x')

    const [resolve] = buildFallbackModels({ ...baseArgs, primaryUniqueModelId: 'openai::gpt-4' })
    const fallback = await resolve()

    // The fallback's middleware plugins are passed to resolveLanguageModel.
    expect(resolveLanguageModel).toHaveBeenCalledWith('anthropic', {}, 'claude-x', plugins)
    // The fallback's own params are lifted as the per-fallback option override.
    expect(fallback?.options).toEqual({ temperature: 0.2, maxOutputTokens: 128 })
    expect(fallback?.model).toMatchObject({ modelId: 'claude-x' })
  })

  it('skips the active model (by stored UniqueModelId) — no resolver created, even when apiModelId differs', () => {
    setPrefs(['openai::gpt-4'])
    expect(buildFallbackModels({ ...baseArgs, primaryUniqueModelId: 'openai::gpt-4' })).toEqual([])
  })

  it('resolves to null for a non-vision fallback when the request has image input', async () => {
    setPrefs(['anthropic::text-only'])
    getByKey.mockResolvedValue(makeModel({ id: 'anthropic::text-only', providerId: 'anthropic', capabilities: [] }))

    const [resolve] = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      requestHasImages: true
    })

    expect(await resolve()).toBeNull()
    expect(buildAgentParams).not.toHaveBeenCalled()
  })

  it('keeps a vision fallback when the request has image input', async () => {
    setPrefs(['anthropic::vision'])
    getByKey.mockResolvedValue(makeModel({ id: 'anthropic::vision', providerId: 'anthropic', capabilities: [VISION] }))
    stubBuildAgentParams('vision-x')

    const [resolve] = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      requestHasImages: true
    })

    expect(await resolve()).not.toBeNull()
  })

  it('resolves to null for a non-function-calling fallback when the request has active tools', async () => {
    setPrefs(['anthropic::no-fc'])
    getByKey.mockResolvedValue(makeModel({ id: 'anthropic::no-fc', providerId: 'anthropic', capabilities: [] }))

    const [resolve] = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      primaryHasTools: true
    })

    expect(await resolve()).toBeNull()
    expect(buildAgentParams).not.toHaveBeenCalled()
  })

  it('resolves to null when the fallback cannot be resolved, without throwing', async () => {
    setPrefs(['gone::deleted'])
    getByProviderId.mockRejectedValue(new Error('provider deleted'))

    const [resolve] = buildFallbackModels({ ...baseArgs, primaryUniqueModelId: 'openai::gpt-4' })

    expect(await resolve()).toBeNull()
  })
})
