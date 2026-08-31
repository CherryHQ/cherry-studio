import { MODALITY, type Model, MODEL_CAPABILITY, SERVER_TOOL } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useModelTagFilter } from '../filters'

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-4',
    providerId: 'openai',
    name: 'GPT-4',
    capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
    inputModalities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('useModelTagFilter', () => {
  it('requires models to match every selected tag', () => {
    const { result } = renderHook(() => useModelTagFilter())

    act(() => {
      result.current.toggleTag(MODEL_CAPABILITY.REASONING)
      result.current.toggleTag(MODEL_CAPABILITY.IMAGE_RECOGNITION)
    })

    expect(result.current.selectedTags).toEqual([MODEL_CAPABILITY.IMAGE_RECOGNITION, MODEL_CAPABILITY.REASONING])
    expect(
      result.current.tagFilter(
        makeModel({
          capabilities: [MODEL_CAPABILITY.REASONING],
          inputModalities: [MODALITY.IMAGE]
        })
      )
    ).toBe(true)
    expect(result.current.tagFilter(makeModel({ capabilities: [MODEL_CAPABILITY.REASONING] }))).toBe(false)
  })

  it('resets the active tags and restores the pass-through filter', () => {
    const { result } = renderHook(() => useModelTagFilter())

    act(() => result.current.toggleTag(MODEL_CAPABILITY.REASONING))
    act(() => result.current.resetTags())

    expect(result.current.selectedTags).toEqual([])
    expect(result.current.tagFilter(makeModel())).toBe(true)
  })

  it('routes web-search tags through provider server-tool availability', () => {
    const { result } = renderHook(() => useModelTagFilter())
    const provider = {
      serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope: 'all-chat-models' }]
    } as Provider

    act(() => result.current.toggleTag(SERVER_TOOL.WEB_SEARCH))

    expect(result.current.tagFilter(makeModel(), provider)).toBe(true)
    expect(result.current.tagFilter(makeModel(), { ...provider, serverTools: [] })).toBe(false)
  })
})
