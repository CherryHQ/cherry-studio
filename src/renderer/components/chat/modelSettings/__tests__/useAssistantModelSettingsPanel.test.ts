import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { toast } from '@renderer/services/toast'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const baseModel: Model = {
  id: 'openai::gpt-4',
  name: 'GPT-4',
  providerId: 'openai',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}

const mocks = vi.hoisted(() => ({
  assistant: undefined as { id: string; settings: Record<string, unknown> } | undefined,
  model: undefined as Model | undefined,
  updateAssistantSettings: vi.fn()
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: mocks.assistant,
    model: mocks.model,
    isLoading: false,
    isModelPending: false,
    updateAssistantSettings: mocks.updateAssistantSettings
  })
}))

vi.mock('@renderer/hooks/chat/useChatTurnFastMode', () => ({
  useChatTurnFastMode: () => [false, vi.fn()]
}))

import { useAssistantModelSettingsPanel } from '../useAssistantModelSettingsPanel'

describe('useAssistantModelSettingsPanel', () => {
  function deferredSave() {
    let resolve!: (value: unknown) => void
    const promise = new Promise((res) => {
      resolve = res
    })
    return { promise, resolve }
  }
  beforeEach(() => {
    cacheService.delete('chat.assistant.reasoning_effort_pending.assistant-1')
    cacheService.delete('chat.assistant.settings_patch_pending.assistant-1')
    mocks.assistant = { id: 'assistant-1', settings: { ...DEFAULT_ASSISTANT_SETTINGS } }
    mocks.model = baseModel
    mocks.updateAssistantSettings.mockReset()
  })

  it('reverts the optimistic reasoning effort when the assistant save resolves without a result', async () => {
    mocks.updateAssistantSettings.mockResolvedValue(undefined)

    const { result } = renderHook(() => useAssistantModelSettingsPanel('assistant-1', 'topic-1'))

    act(() => result.current.handleReasoningEffortChange('high'))
    expect(result.current.reasoningEffort).toBe('high')

    await act(async () => {})

    expect(result.current.reasoningEffort).toBe('default')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reverts the optimistic reasoning effort and reports the failure when the assistant save rejects', async () => {
    mocks.updateAssistantSettings.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useAssistantModelSettingsPanel('assistant-1', 'topic-1'))

    act(() => result.current.handleReasoningEffortChange('high'))
    expect(result.current.reasoningEffort).toBe('high')

    await act(async () => {})

    expect(result.current.reasoningEffort).toBe('default')
    expect(toast.error).toHaveBeenCalledWith('common.save_failed')
  })

  it('reverts the optimistic sampling patch when the assistant save resolves without a result', async () => {
    const deferred = deferredSave()
    mocks.updateAssistantSettings.mockReturnValue(deferred.promise)

    const { result } = renderHook(() => useAssistantModelSettingsPanel('assistant-1', 'topic-1'))

    await act(async () => {
      void result.current.patchSettings({ temperature: 0.5 })
    })
    expect(result.current.settings?.temperature).toBe(0.5)

    await act(async () => {
      deferred.resolve(undefined)
    })

    expect(result.current.settings?.temperature).toBe(DEFAULT_ASSISTANT_SETTINGS.temperature)
  })

  it('keeps the optimistic sampling patch after the assistant save succeeds', async () => {
    const deferred = deferredSave()
    mocks.updateAssistantSettings.mockReturnValue(deferred.promise)

    const { result } = renderHook(() => useAssistantModelSettingsPanel('assistant-1', 'topic-1'))

    await act(async () => {
      void result.current.patchSettings({ temperature: 0.5 })
    })
    expect(result.current.settings?.temperature).toBe(0.5)

    await act(async () => {
      deferred.resolve({ id: 'assistant-1' })
    })

    expect(result.current.settings?.temperature).toBe(0.5)
  })
})
