import { CHERRY_CLOUD_MODEL_FEATURE, type CherryCloudModelFeature } from '@shared/data/presets/cherryai'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentModelFilter } from '../useAgentModelFilter'

const mocks = vi.hoisted(() => ({
  cloudAvailability: {
    entitledModelIds: [] as Model['id'][],
    quotaExhaustedModelIds: [] as Model['id'][],
    featuresByModelId: {} as Record<Model['id'], CherryCloudModelFeature[]>
  }
}))

vi.mock('../../useCherryCloudModelAvailability', () => ({
  useCherryCloudModelAvailability: () => ({
    isModelAvailableForFeature: (model: Model, feature: CherryCloudModelFeature) =>
      model.providerId !== 'cherryai-subscription' ||
      mocks.cloudAvailability.featuresByModelId[model.id]?.includes(feature),
    isModelDisabled: (model: Model) =>
      model.providerId === 'cherryai-subscription' &&
      (!mocks.cloudAvailability.entitledModelIds.includes(model.id) ||
        mocks.cloudAvailability.quotaExhaustedModelIds.includes(model.id))
  })
}))

function model(capabilities: Model['capabilities'] = []): Model {
  return {
    id: 'openai::gpt-4o',
    providerId: 'openai',
    name: 'GPT-4o',
    contextWindow: 128_000,
    capabilities,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } as Model
}

const providers = {
  openai: { id: 'openai', defaultChatEndpoint: 'openai-chat-completions', authType: 'api-key' },
  anthropic: { id: 'anthropic', defaultChatEndpoint: 'anthropic-messages', authType: 'api-key' },
  gemini: { id: 'gemini', defaultChatEndpoint: 'google-generate-content', authType: 'api-key' },
  vertex: {
    id: 'vertex',
    defaultChatEndpoint: 'google-generate-content',
    endpointConfigs: { 'google-generate-content': { adapterFamily: 'google-vertex' } },
    authType: 'iam-gcp'
  }
} as const satisfies Record<string, Partial<Provider>>

describe('useAgentModelFilter', () => {
  beforeEach(() => {
    mocks.cloudAvailability = {
      entitledModelIds: [],
      quotaExhaustedModelIds: [],
      featuresByModelId: {}
    }
  })

  it('allows Gemini provider models for Claude Code agents', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current({ ...model(), providerId: 'gemini', id: 'gemini::gemini-2.5-pro' })).toBe(true)
    expect(result.current({ ...model(), providerId: 'google-custom', id: 'google-custom::gemini-2.5-pro' })).toBe(true)
  })

  it('continues to reject non-chat model classes for regular agents', () => {
    const { result } = renderHook(() => useAgentModelFilter(undefined))

    expect(result.current(model())).toBe(true)
    expect(result.current(model([MODEL_CAPABILITY.EMBEDDING]))).toBe(false)
  })

  it('accepts only Cloud models enabled for Agent by the latest sync result', () => {
    const cloudModel = {
      ...model(),
      id: 'cherryai-subscription::deepseek-go',
      providerId: 'cherryai-subscription'
    } as Model
    mocks.cloudAvailability = {
      entitledModelIds: [cloudModel.id],
      quotaExhaustedModelIds: [],
      featuresByModelId: { [cloudModel.id]: [CHERRY_CLOUD_MODEL_FEATURE.AGENT] }
    }
    const { result } = renderHook(() => useAgentModelFilter(undefined))

    expect(result.current(cloudModel)).toBe(true)
    expect(result.current({ ...cloudModel, id: 'cherryai-subscription::chat-only' })).toBe(false)
  })

  describe('pi agents', () => {
    it('allows models on providers pi can drive', () => {
      const { result } = renderHook(() => useAgentModelFilter('pi'))

      expect(
        result.current({ ...model(), providerId: 'openai', id: 'openai::gpt-4o' }, providers.openai as Provider)
      ).toBe(true)
      expect(
        result.current(
          { ...model(), providerId: 'anthropic', id: 'anthropic::claude-sonnet' },
          providers.anthropic as Provider
        )
      ).toBe(true)
      expect(
        result.current({ ...model(), providerId: 'gemini', id: 'gemini::gemini-2.5-pro' }, providers.gemini as Provider)
      ).toBe(true)
    })

    it('filters models whose provider has no pi API mapping', () => {
      const { result } = renderHook(() => useAgentModelFilter('pi'))

      // Vertex is unsupported for pi (D2).
      expect(
        result.current({ ...model(), providerId: 'vertex', id: 'vertex::gemini-2.5-pro' }, providers.vertex as Provider)
      ).toBe(false)
      // Unknown provider (no entry) cannot be resolved → filtered.
      expect(result.current({ ...model(), providerId: 'ghost', id: 'ghost::model' })).toBe(false)
    })

    it('still rejects non-chat model classes for pi', () => {
      const { result } = renderHook(() => useAgentModelFilter('pi'))

      expect(result.current({ ...model([MODEL_CAPABILITY.EMBEDDING]), providerId: 'openai' })).toBe(false)
    })
  })
})
