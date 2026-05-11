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

  it('does not query DataApi for the default assistant sentinel', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'openai::gpt-4o')

    const { result } = renderHook(() => useAssistant(DEFAULT_ASSISTANT_ID))

    expect(result.current.assistant?.id).toBe(DEFAULT_ASSISTANT_ID)
    expect(result.current.assistant?.modelId).toBe('openai::gpt-4o')
    expect(mockUseQuery).toHaveBeenCalledWith('/assistants/:id', { params: { id: '' }, enabled: false })
  })

  it('updates chat.default_model_id when changing the default assistant model', async () => {
    const { result } = renderHook(() => useAssistant(DEFAULT_ASSISTANT_ID))

    await act(async () => {
      result.current.setModel({ id: 'gpt-4o', provider: 'openai' } as never)
    })

    expect(MockUsePreferenceUtils.getPreferenceValue('chat.default_model_id')).toBe('openai::gpt-4o')
  })
})
