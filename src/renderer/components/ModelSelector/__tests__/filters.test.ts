import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useModelTagFilter } from '../filters'

function makeModel(capabilities: Model['capabilities']): Model {
  return {
    id: 'openai::gpt-4',
    providerId: 'openai',
    name: 'GPT-4',
    capabilities,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } as Model
}

describe('useModelTagFilter', () => {
  it('requires models to match every selected tag', () => {
    const { result } = renderHook(() => useModelTagFilter())

    act(() => {
      result.current.toggleTag(MODEL_CAPABILITY.REASONING)
      result.current.toggleTag(MODEL_CAPABILITY.FUNCTION_CALL)
    })

    expect(result.current.selectedTags).toEqual([MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL])
    expect(result.current.tagFilter(makeModel([MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL]))).toBe(true)
    expect(result.current.tagFilter(makeModel([MODEL_CAPABILITY.REASONING]))).toBe(false)
  })

  it('resets the active tags and restores the pass-through filter', () => {
    const { result } = renderHook(() => useModelTagFilter())

    act(() => result.current.toggleTag(MODEL_CAPABILITY.REASONING))
    act(() => result.current.resetTags())

    expect(result.current.selectedTags).toEqual([])
    expect(result.current.tagFilter(makeModel([]))).toBe(true)
  })
})
