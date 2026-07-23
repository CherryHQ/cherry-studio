import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
})
