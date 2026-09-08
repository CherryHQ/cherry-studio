import { DataApiErrorFactory } from '@shared/data/api/errors'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel, makeProvider } from '../../../../__tests__/fixtures'
import type { RetryPolicy } from '../retryPolicy'

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

const usagePlugin = { name: 'usage' }
const createUsagePlugin = vi.fn().mockReturnValue(usagePlugin)

const VISION = MODEL_CAPABILITY.IMAGE_RECOGNITION
const AUDIO = MODEL_CAPABILITY.AUDIO_RECOGNITION
const VIDEO = MODEL_CAPABILITY.VIDEO_RECOGNITION
const NO_NATIVE_SUPPORT = { image: false, pdf: false, audio: false, video: false } as const
const ALL_NATIVE_SUPPORT = { image: true, pdf: true, audio: true, video: true } as const

function policy(fallbackModelIds: readonly string[], enabled = true): RetryPolicy {
  return {
    enabled,
    maxAttempts: 2,
    backoffEnabled: false,
    fallbackModelIds: fallbackModelIds as RetryPolicy['fallbackModelIds']
  }
}

/** buildAgentParams stub: returns the fallback model's own plugins + params. */
function stubBuildAgentParams(modelId: string) {
  const plugins = [{ name: `mw-${modelId}` }]
  const repairToolCall = vi.fn()
  const credentialReceipt = { attribution: 'matched' as const, id: 'fallback-key', masked: 'sk-f****back' }
  buildAgentParams.mockResolvedValue({
    sdkConfig: { providerId: 'anthropic', providerSettings: {}, modelId },
    credentialReceipt,
    plugins,
    options: { temperature: 0.2, maxOutputTokens: 128, repairToolCall },
    nativeFileSupport: ALL_NATIVE_SUPPORT
  })
  return { plugins, repairToolCall, credentialReceipt }
}

const baseArgs = {
  request: { messages: [] } as never,
  assistant: undefined,
  signal: undefined,
  primaryHasTools: false,
  requiredNativeFileSupport: NO_NATIVE_SUPPORT,
  extraFeatures: [],
  retryPolicy: policy([]),
  createUsagePlugin
}

describe('buildFallbackModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getByProviderId.mockReturnValue(makeProvider({ id: 'anthropic' }))
    resolveLanguageModel.mockImplementation(async (_pid, _settings, modelId) => ({ modelId, _resolved: true }))
  })

  it('returns [] when retry is disabled', () => {
    expect(
      buildFallbackModels({
        ...baseArgs,
        primaryUniqueModelId: 'openai::gpt-4',
        retryPolicy: policy(['anthropic::claude'], false)
      })
    ).toEqual([])
  })

  it('is lazy — no provider/model/buildAgentParams work until a resolver is invoked', () => {
    getByKey.mockReturnValue(makeModel({ id: 'anthropic::claude', providerId: 'anthropic', apiModelId: 'claude-x' }))
    stubBuildAgentParams('claude-x')

    const resolvers = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      retryPolicy: policy(['anthropic::claude'])
    })

    expect(resolvers).toHaveLength(1)
    expect(getByKey).not.toHaveBeenCalled()
    expect(buildAgentParams).not.toHaveBeenCalled()
    expect(resolveLanguageModel).not.toHaveBeenCalled()
  })

  it('resolves a fallback with its OWN plugins and lifts its OWN param overrides', async () => {
    getByKey.mockReturnValue(makeModel({ id: 'anthropic::claude', providerId: 'anthropic', apiModelId: 'claude-x' }))
    const { plugins, repairToolCall, credentialReceipt } = stubBuildAgentParams('claude-x')

    const [resolve] = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      retryPolicy: policy(['anthropic::claude'])
    })
    const fallback = await resolve()

    // The fallback's middleware plugins are passed to resolveLanguageModel.
    expect(createUsagePlugin).toHaveBeenCalledWith({
      provider: expect.objectContaining({ id: 'anthropic' }),
      model: expect.objectContaining({ id: 'anthropic::claude' }),
      sdkModelId: 'claude-x',
      credentialReceipt
    })
    expect(resolveLanguageModel).toHaveBeenCalledWith('anthropic', {}, 'claude-x', [...plugins, usagePlugin])
    const buildOptions = buildAgentParams.mock.calls[0][0]
    expect(buildOptions.getRepairUsagePlugins()).toEqual([usagePlugin])
    // The fallback's own params are lifted as the per-fallback option override.
    expect(fallback?.options).toEqual({ temperature: 0.2, maxOutputTokens: 128 })
    expect(fallback?.model).toMatchObject({ modelId: 'claude-x' })
    expect(fallback?.repairToolCall).toBe(repairToolCall)
  })

  it('skips the active model (by stored UniqueModelId) — no resolver created, even when apiModelId differs', () => {
    expect(
      buildFallbackModels({
        ...baseArgs,
        primaryUniqueModelId: 'openai::gpt-4',
        retryPolicy: policy(['openai::gpt-4'])
      })
    ).toEqual([])
  })

  it('resolves to null for a non-vision fallback when the request has image input', async () => {
    getByKey.mockReturnValue(makeModel({ id: 'anthropic::text-only', providerId: 'anthropic', capabilities: [] }))

    const [resolve] = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      requiredNativeFileSupport: { ...NO_NATIVE_SUPPORT, image: true },
      retryPolicy: policy(['anthropic::text-only'])
    })

    expect(await resolve()).toBeNull()
    expect(buildAgentParams).not.toHaveBeenCalled()
  })

  it('keeps a vision fallback when the request has image input', async () => {
    getByKey.mockReturnValue(makeModel({ id: 'anthropic::vision', providerId: 'anthropic', capabilities: [VISION] }))
    stubBuildAgentParams('vision-x')

    const [resolve] = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      requiredNativeFileSupport: { ...NO_NATIVE_SUPPORT, image: true },
      retryPolicy: policy(['anthropic::vision'])
    })

    expect(await resolve()).not.toBeNull()
  })

  it('resolves to null for a non-function-calling fallback when the request has active tools', async () => {
    getByKey.mockReturnValue(makeModel({ id: 'anthropic::no-fc', providerId: 'anthropic', capabilities: [] }))

    const [resolve] = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      primaryHasTools: true,
      retryPolicy: policy(['anthropic::no-fc'])
    })

    expect(await resolve()).toBeNull()
    expect(buildAgentParams).not.toHaveBeenCalled()
  })

  it('resolves to null when the configured provider or model was deleted', async () => {
    getByProviderId.mockImplementation(() => {
      throw DataApiErrorFactory.notFound('Provider', 'gone')
    })

    const [resolve] = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      retryPolicy: policy(['gone::deleted'])
    })

    expect(await resolve()).toBeNull()
  })

  it.each([
    ['audio', AUDIO],
    ['video', VIDEO]
  ] as const)('gates %s fallbacks before building them', async (type, capability) => {
    getByKey.mockReturnValue(makeModel({ id: `anthropic::${type}`, providerId: 'anthropic', capabilities: [] }))
    const [resolveUnsupported] = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      requiredNativeFileSupport: { ...NO_NATIVE_SUPPORT, [type]: true },
      retryPolicy: policy([`anthropic::${type}`])
    })
    expect(await resolveUnsupported()).toBeNull()

    getByKey.mockReturnValue(
      makeModel({ id: `anthropic::${type}`, providerId: 'anthropic', capabilities: [capability] })
    )
    stubBuildAgentParams(`${type}-model`)
    const [resolveSupported] = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      requiredNativeFileSupport: { ...NO_NATIVE_SUPPORT, [type]: true },
      retryPolicy: policy([`anthropic::${type}`])
    })
    expect(await resolveSupported()).not.toBeNull()
  })

  it('gates native PDF support after resolving fallback provider parameters', async () => {
    getByKey.mockReturnValue(makeModel({ id: 'anthropic::pdf', providerId: 'anthropic' }))
    stubBuildAgentParams('pdf-model')
    buildAgentParams.mockResolvedValueOnce({
      sdkConfig: { providerId: 'anthropic', providerSettings: {}, modelId: 'pdf-model' },
      plugins: [],
      options: {},
      nativeFileSupport: NO_NATIVE_SUPPORT
    })
    const [resolve] = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      requiredNativeFileSupport: { ...NO_NATIVE_SUPPORT, pdf: true },
      retryPolicy: policy(['anthropic::pdf'])
    })

    expect(await resolve()).toBeNull()
    expect(resolveLanguageModel).not.toHaveBeenCalled()
  })

  it('rejects unexpected and abort errors instead of hiding them', async () => {
    const unexpected = new Error('database unavailable')
    getByProviderId.mockImplementationOnce(() => {
      throw unexpected
    })
    const [resolveUnexpected] = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      retryPolicy: policy(['anthropic::fallback'])
    })
    await expect(resolveUnexpected()).rejects.toBe(unexpected)

    const abort = new DOMException('aborted', 'AbortError')
    getByProviderId.mockImplementationOnce(() => {
      throw abort
    })
    const [resolveAbort] = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      retryPolicy: policy(['anthropic::fallback'])
    })
    await expect(resolveAbort()).rejects.toBe(abort)
  })

  it('drops invalid, active, and duplicate fallback ids deterministically', () => {
    const resolvers = buildFallbackModels({
      ...baseArgs,
      primaryUniqueModelId: 'openai::gpt-4',
      retryPolicy: policy(['invalid', 'openai::gpt-4', 'anthropic::claude', 'anthropic::claude'])
    })

    expect(resolvers).toHaveLength(1)
  })
})
