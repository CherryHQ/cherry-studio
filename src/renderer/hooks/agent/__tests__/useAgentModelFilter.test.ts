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
})
