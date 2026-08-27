import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { modelFilterIncludesAgentOnlyProviders, useAgentModelFilter } from '../useAgentModelFilter'

const mocks = vi.hoisted(() => ({
  cloudAvailability: {
    modelCount: 0,
    entitledModelIds: [] as Model['id'][],
    quotaExhaustedModelIds: [] as Model['id'][]
  }
}))

vi.mock('swr', () => ({ default: () => ({ data: mocks.cloudAvailability }) }))

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
    mocks.cloudAvailability = { modelCount: 0, entitledModelIds: [], quotaExhaustedModelIds: [] }
  })

  it('allows Gemini provider models for Claude Code agents', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current({ ...model(), providerId: 'gemini', id: 'gemini::gemini-2.5-pro' })).toBe(true)
    expect(result.current({ ...model(), providerId: 'google-custom', id: 'google-custom::gemini-2.5-pro' })).toBe(true)
  })

  it('marks its predicate so selectors surface agent-only providers', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(modelFilterIncludesAgentOnlyProviders(result.current)).toBe(true)
    expect(modelFilterIncludesAgentOnlyProviders(() => true)).toBe(false)
    expect(modelFilterIncludesAgentOnlyProviders(undefined)).toBe(false)
  })

  it('continues to reject non-chat model classes for regular agents', () => {
    const { result } = renderHook(() => useAgentModelFilter(undefined))

    expect(result.current(model())).toBe(true)
    expect(result.current(model([MODEL_CAPABILITY.EMBEDDING]))).toBe(false)
  })

  it('disables only Cloud models whose quota is exhausted', () => {
    const exhaustedModel = {
      ...model(),
      id: 'cherry-cloud::deepseek-free',
      providerId: 'cherry-cloud'
    } as Model
    const availableModel = {
      ...model(),
      id: 'cherry-cloud::deepseek-go',
      providerId: 'cherry-cloud'
    } as Model
    mocks.cloudAvailability = {
      modelCount: 2,
      entitledModelIds: [exhaustedModel.id, availableModel.id],
      quotaExhaustedModelIds: [exhaustedModel.id]
    }

    const { result } = renderHook(() => useAgentModelFilter('pi'))

    expect(result.current.isModelDisabled?.(exhaustedModel)).toBe(true)
    expect(result.current.isModelDisabled?.(availableModel)).toBe(false)
    expect(result.current.isModelDisabled?.(model())).toBe(false)
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
