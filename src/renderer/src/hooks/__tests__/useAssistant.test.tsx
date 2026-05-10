import { DEFAULT_ASSISTANT_ID } from '@shared/data/types/assistant'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDefaultAssistant } from '../useAssistant'

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
})
