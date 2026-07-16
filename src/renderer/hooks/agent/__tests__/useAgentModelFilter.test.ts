import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const providersMock = vi.hoisted(() => ({
  providers: [] as Array<Record<string, unknown>>
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => providersMock
}))

import { modelFilterIncludesAgentOnlyProviders, useAgentModelFilter } from '../useAgentModelFilter'

function model(capabilities: Model['capabilities'] = []): Model {
  return {
    id: 'openai::gpt-4o',
    providerId: 'openai',
    name: 'GPT-4o',
    capabilities,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } as Model
}

describe('useAgentModelFilter', () => {
  it('allows chat-capable models from non-Anthropic providers for Claude Code agents', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current(model())).toBe(true)
    expect(result.current({ ...model(), providerId: 'anthropic', id: 'anthropic::claude-sonnet' })).toBe(true)
    expect(result.current({ ...model(), providerId: 'custom-openai', id: 'custom-openai::gpt-4o' })).toBe(true)
    expect(result.current({ ...model(), providerId: 'vertex', id: 'vertex::gemini-2.5-pro' })).toBe(true)
  })

  it('allows Gemini provider models for Claude Code agents', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current({ ...model(), providerId: 'gemini', id: 'gemini::gemini-2.5-pro' })).toBe(true)
    expect(result.current({ ...model(), providerId: 'google-custom', id: 'google-custom::gemini-2.5-pro' })).toBe(true)
  })

  it('filters the managed CherryAI default model for Claude Code agents', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(
      result.current({ ...model(), providerId: 'cherryai', id: 'cherryai::qwen', apiModelId: 'qwen', name: 'Qwen' })
    ).toBe(false)
  })

  it('filters provider IDs that the API Gateway cannot route for Claude Code agents', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current({ ...model(), providerId: 'corp:west', id: 'corp:west::gpt-4o' })).toBe(false)
  })

  it('marks its predicate as an agent picker so selectors surface agent-only providers', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(modelFilterIncludesAgentOnlyProviders(result.current)).toBe(true)
  })

  it('treats an unmarked filter (or none) as a general selector', () => {
    expect(modelFilterIncludesAgentOnlyProviders(() => true)).toBe(false)
    expect(modelFilterIncludesAgentOnlyProviders(undefined)).toBe(false)
  })

  it('continues to reject non-chat model classes', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current(model([MODEL_CAPABILITY.EMBEDDING]))).toBe(false)
    expect(result.current(model([MODEL_CAPABILITY.RERANK]))).toBe(false)
    expect(result.current(model([MODEL_CAPABILITY.IMAGE_GENERATION]))).toBe(false)
    expect(result.current(model([MODEL_CAPABILITY.AUDIO_GENERATION]))).toBe(false)
    expect(result.current(model([MODEL_CAPABILITY.VIDEO_GENERATION]))).toBe(false)
  })

  describe('pi agents', () => {
    beforeEach(() => {
      providersMock.providers = [
        { id: 'openai', defaultChatEndpoint: 'openai-chat-completions', authType: 'api-key' },
        { id: 'anthropic', defaultChatEndpoint: 'anthropic-messages', authType: 'api-key' },
        { id: 'gemini', defaultChatEndpoint: 'google-generate-content', authType: 'api-key' },
        // Vertex reuses the Google endpoint but authenticates with a service
        // account — pi cannot drive it, so it must be filtered out.
        {
          id: 'vertex',
          defaultChatEndpoint: 'google-generate-content',
          endpointConfigs: { 'google-generate-content': { adapterFamily: 'google-vertex' } },
          authType: 'iam-gcp'
        }
      ]
    })

    it('allows models on providers pi can drive', () => {
      const { result } = renderHook(() => useAgentModelFilter('pi'))

      expect(result.current({ ...model(), providerId: 'openai', id: 'openai::gpt-4o' })).toBe(true)
      expect(result.current({ ...model(), providerId: 'anthropic', id: 'anthropic::claude-sonnet' })).toBe(true)
      expect(result.current({ ...model(), providerId: 'gemini', id: 'gemini::gemini-2.5-pro' })).toBe(true)
    })

    it('filters models whose provider has no pi API mapping', () => {
      const { result } = renderHook(() => useAgentModelFilter('pi'))

      // Vertex is unsupported for pi (D2).
      expect(result.current({ ...model(), providerId: 'vertex', id: 'vertex::gemini-2.5-pro' })).toBe(false)
      // Unknown provider (no entry) cannot be resolved → filtered.
      expect(result.current({ ...model(), providerId: 'ghost', id: 'ghost::model' })).toBe(false)
    })

    it('still rejects non-chat model classes for pi', () => {
      const { result } = renderHook(() => useAgentModelFilter('pi'))

      expect(result.current({ ...model([MODEL_CAPABILITY.EMBEDDING]), providerId: 'openai' })).toBe(false)
    })
  })
})
