import { DEFAULT_ASSISTANT_ID } from '@shared/data/types/assistant'
import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAssistant, useDefaultAssistant } from '../useAssistant'

describe('useDefaultAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
  })

  it('returns an assistant with the sentinel default id', () => {
    const { result } = renderHook(() => useDefaultAssistant())
    expect(result.current.assistant.id).toBe(DEFAULT_ASSISTANT_ID)
  })

  it('reflects the chat.default_model_id preference in assistant.modelId', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'openai::gpt-4o')

    const { result } = renderHook(() => useDefaultAssistant())

    expect(result.current.assistant.modelId).toBe('openai::gpt-4o')
  })

  it('applies default assistant preference overrides', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_assistant', {
      name: 'Default writer',
      emoji: ':)',
      prompt: 'Write concise answers.',
      settings: { temperature: 0.2, enableTemperature: true, contextCount: 3 }
    })

    const { result } = renderHook(() => useDefaultAssistant())

    expect(result.current.defaultAssistant.name).toBe('Default writer')
    expect(result.current.defaultAssistant.emoji).toBe(':)')
    expect(result.current.defaultAssistant.prompt).toBe('Write concise answers.')
    expect(result.current.defaultAssistant.settings.temperature).toBe(0.2)
    expect((result.current.defaultAssistant.settings as { contextCount?: number }).contextCount).toBe(3)
  })

  it('updates the default assistant preference', () => {
    const { result } = renderHook(() => useDefaultAssistant())

    act(() => {
      result.current.updateDefaultAssistant({
        ...result.current.defaultAssistant,
        name: 'Updated default',
        prompt: 'Use this prompt.',
        settings: {
          ...result.current.defaultAssistant.settings,
          temperature: 0.4,
          contextCount: 2
        } as typeof result.current.defaultAssistant.settings
      })
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.default_assistant')).toMatchObject({
      name: 'Updated default',
      prompt: 'Use this prompt.',
      settings: { temperature: 0.4, contextCount: 2 }
    })
  })

  it('returns null modelId when preference is unset', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', null)

    const { result } = renderHook(() => useDefaultAssistant())

    expect(result.current.assistant.modelId).toBeNull()
  })

  it('always returns a defined assistant — no loading state', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', null)

    const { result } = renderHook(() => useDefaultAssistant())

    expect(result.current.assistant).toBeDefined()
    expect(result.current.assistant.settings).toBeDefined()
    expect(result.current.assistant.mcpServerIds).toEqual([])
    expect(result.current.assistant.knowledgeBaseIds).toEqual([])
  })
})

describe('useAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
  })

  it('disables the DataApi query when id is null', () => {
    renderHook(() => useAssistant(null))

    expect(mockUseQuery).toHaveBeenCalledWith('/assistants/:id', { params: { id: '' }, enabled: false })
  })

  it('disables the DataApi query when id is undefined', () => {
    renderHook(() => useAssistant(undefined))

    expect(mockUseQuery).toHaveBeenCalledWith('/assistants/:id', { params: { id: '' }, enabled: false })
  })

  it('returns assistant: undefined for a topic without an assistant', () => {
    const { result } = renderHook(() => useAssistant(null))

    expect(result.current.assistant).toBeUndefined()
  })
})
