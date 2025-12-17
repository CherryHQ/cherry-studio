import type { Model } from '@renderer/types'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useModelTagFilter } from '../filters'

const mocks = vi.hoisted(() => ({
  isVisionModel: vi.fn(),
  isEmbeddingModel: vi.fn(),
  isReasoningModel: vi.fn(),
  isFunctionCallingModel: vi.fn(),
  isWebSearchModel: vi.fn(),
  isRerankModel: vi.fn(),
  isFreeModel: vi.fn()
}))

vi.mock('@renderer/config/models', () => ({
  isEmbeddingModel: mocks.isEmbeddingModel,
  isFunctionCallingModel: mocks.isFunctionCallingModel,
  isReasoningModel: mocks.isReasoningModel,
  isRerankModel: mocks.isRerankModel,
  isVisionModel: mocks.isVisionModel,
  isWebSearchModel: mocks.isWebSearchModel
}))

vi.mock('@renderer/utils/model', () => ({
  isFreeModel: mocks.isFreeModel
}))

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'm1',
    provider: 'openai',
    name: 'Model-1',
    group: 'default',
    ...overrides
  }
}

describe('useModelTagFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should have all tags unselected initially', () => {
    const { result } = renderHook(() => useModelTagFilter())

    expect(result.current.tagSelection).toEqual({
      vision: false,
      embedding: false,
      reasoning: false,
      function_calling: false,
      web_search: false,
      rerank: false,
      free: false
    })
    expect(result.current.selectedTags).toEqual([])
  })

  it('should toggle a tag state', () => {
    const { result } = renderHook(() => useModelTagFilter())

    act(() => result.current.toggleTag('vision'))
    expect(result.current.tagSelection.vision).toBe(true)
    expect(result.current.selectedTags).toEqual(['vision'])

    act(() => result.current.toggleTag('vision'))
    expect(result.current.tagSelection.vision).toBe(false)
    expect(result.current.selectedTags).toEqual([])
  })

  it('should reset all tags to false', () => {
    const { result } = renderHook(() => useModelTagFilter())

    act(() => result.current.toggleTag('vision'))
    act(() => result.current.toggleTag('embedding'))
    expect(result.current.selectedTags.sort()).toEqual(['embedding', 'vision'])

    act(() => result.current.resetTags())
    expect(result.current.selectedTags).toEqual([])
    expect(Object.values(result.current.tagSelection).every((v) => v === false)).toBe(true)
  })

  it('tagFilter returns true when no tags selected', () => {
    const { result } = renderHook(() => useModelTagFilter())
    const model = createModel()
    const passed = result.current.tagFilter(model)
    expect(passed).toBe(true)
    expect(mocks.isVisionModel).not.toHaveBeenCalled()
  })

  it('tagFilter uses single selected tag predicate', () => {
    const { result } = renderHook(() => useModelTagFilter())
    const model = createModel()

    mocks.isVisionModel.mockReturnValueOnce(true)
    act(() => result.current.toggleTag('vision'))

    const ok = result.current.tagFilter(model)
    expect(ok).toBe(true)
    expect(mocks.isVisionModel).toHaveBeenCalledTimes(1)
    expect(mocks.isVisionModel).toHaveBeenCalledWith(model)
  })

  it('tagFilter requires all selected tags to match (AND logic)', () => {
    const { result } = renderHook(() => useModelTagFilter())
    const model = createModel()

    act(() => result.current.toggleTag('vision'))
    act(() => result.current.toggleTag('embedding'))

    // 第一次：vision=true, embedding=false => 应为 false
    mocks.isVisionModel.mockReturnValueOnce(true)
    mocks.isEmbeddingModel.mockReturnValueOnce(false)
    expect(result.current.tagFilter(model)).toBe(false)

    // 第二次：vision=true, embedding=true => 应为 true
    mocks.isVisionModel.mockReturnValueOnce(true)
    mocks.isEmbeddingModel.mockReturnValueOnce(true)
    expect(result.current.tagFilter(model)).toBe(true)
  })
})
