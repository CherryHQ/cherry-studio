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

  it('returns [] when retry is disabled', async () => {
    setPrefs(['anthropic::claude'], false)
    expect(await buildFallbackModels({ ...baseArgs, primaryUniqueModelId: 'openai::gpt-4' })).toEqual([])
  })

  it('resolves each fallback with its OWN plugins and lifts its OWN param overrides', async () => {
    setPrefs(['anthropic::claude'])
    getByKey.mockResolvedValue(makeModel({ id: 'anthropic::claude', providerId: 'anthropic', apiModelId: 'claude-x' }))
    const plugins = stubBuildAgentParams('claude-x')

    const result = await buildFallbackModels({ ...baseArgs, primaryUniqueModelId: 'openai::gpt-4' })

    // The fallback's middleware plugins are passed to resolveLanguageModel.
    expect(resolveLanguageModel).toHaveBeenCalledWith('anthropic', {}, 'claude-x', plugins)
    // The fallback's own params are lifted as the per-fallback option override.
    expect(result).toHaveLength(1)
    expect(result[0].options).toEqual({ temperature: 0.2, maxOutputTokens: 128 })
    expect(result[0].model).toMatchObject({ modelId: 'claude-x' })
  })

  it('skips the active model (by stored UniqueModelId) even when apiModelId differs', async () => {
    setPrefs(['openai::gpt-4'])
    const result = await buildFallbackModels({ ...baseArgs, primaryUniqueModelId: 'openai::gpt-4' })
    expect(result).toEqual([])
    expect(buildAgentParams).not.toHaveBeenCalled()
    expect(resolveLanguageModel).not.toHaveBeenCalled()
  })

  it('skips a non-vision fallback when the request has image input', async () => {
    setPrefs(['anthropic::text-only'])
    getByKey.mockResolvedValue(makeModel({ id: 'anthropic::text-only', providerId: 'anthropic', capabilities: [] }))

    const result = await buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      requestHasImages: true
    })

    expect(result).toEqual([])
    expect(buildAgentParams).not.toHaveBeenCalled()
  })

  it('keeps a vision fallback when the request has image input', async () => {
    setPrefs(['anthropic::vision'])
    getByKey.mockResolvedValue(makeModel({ id: 'anthropic::vision', providerId: 'anthropic', capabilities: [VISION] }))
    stubBuildAgentParams('vision-x')

    const result = await buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      requestHasImages: true
    })

    expect(result).toHaveLength(1)
  })

  it('skips a non-function-calling fallback when the request has active tools', async () => {
    setPrefs(['anthropic::no-fc'])
    getByKey.mockResolvedValue(makeModel({ id: 'anthropic::no-fc', providerId: 'anthropic', capabilities: [] }))

    const result = await buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      primaryHasTools: true
    })

    expect(result).toEqual([])
    expect(buildAgentParams).not.toHaveBeenCalled()
  })

  it('skips a fallback that fails to resolve, without failing the request', async () => {
    setPrefs(['gone::deleted', 'anthropic::ok'])
    getByProviderId.mockImplementation(async (id: string) => {
      if (id === 'gone') throw new Error('provider deleted')
      return makeProvider({ id })
    })
    getByKey.mockResolvedValue(makeModel({ id: 'anthropic::ok', providerId: 'anthropic', apiModelId: 'ok-x' }))
    stubBuildAgentParams('ok-x')

    const result = await buildFallbackModels({ ...baseArgs, primaryUniqueModelId: 'openai::gpt-4' })

    expect(result).toHaveLength(1)
    expect(result[0].model).toMatchObject({ modelId: 'ok-x' })
  })
})
