import { toast } from '@renderer/services/toast'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTopicNamingErrorNotification } from '../useTopicNamingErrorNotification'

const mockUseIpcOn = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({
  useIpcOn: mockUseIpcOn
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn() }
}))

describe('useTopicNamingErrorNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows an error toast with the translated title and original message on ai.topic_naming_failed', () => {
    let emitFailed: ((payload: { message: string }) => void) | undefined
    mockUseIpcOn.mockImplementation((event: string, handler: (payload: { message: string }) => void) => {
      if (event === 'ai.topic_naming_failed') emitFailed = handler
    })

    renderHook(() => useTopicNamingErrorNotification())

    expect(mockUseIpcOn).toHaveBeenCalledWith('ai.topic_naming_failed', expect.any(Function))

    act(() => {
      emitFailed?.({ message: 'Invalid signature' })
    })

    expect(toast.error).toHaveBeenCalledWith({
      title: 'chat.topics.auto_rename_failed',
      description: 'Invalid signature'
    })
  })
})
