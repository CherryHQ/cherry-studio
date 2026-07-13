import { toast } from '@renderer/services/toast'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/data/hooks/usePreference', async () => {
  const { MockUsePreference } = await import('@test-mocks/renderer/usePreference')
  return MockUsePreference
})

import { useComposerToolbarPinnedTools } from '../useComposerToolbarPinnedTools'

describe('useComposerToolbarPinnedTools', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('exposes the preference value and persists updates', async () => {
    const setPreference = vi.fn().mockResolvedValue(undefined)
    MockUsePreferenceUtils.mockPreferenceReturn('chat.input.toolbar.pinned_tools', ['thinking'], setPreference)

    const { result } = renderHook(() => useComposerToolbarPinnedTools('chat.input.toolbar.pinned_tools'))

    expect(result.current.pinnedIds).toEqual(['thinking'])

    act(() => {
      result.current.setPinnedIds(['thinking', 'web-search'])
    })

    expect(setPreference).toHaveBeenCalledWith(['thinking', 'web-search'])
  })

  it('surfaces a toast when persisting fails', async () => {
    const setPreference = vi.fn().mockRejectedValue(new Error('persist failed'))
    MockUsePreferenceUtils.mockPreferenceReturn('agent.input.toolbar.pinned_tools', ['thinking'], setPreference)

    const { result } = renderHook(() => useComposerToolbarPinnedTools('agent.input.toolbar.pinned_tools'))

    act(() => {
      result.current.setPinnedIds([])
    })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('common.error')
    })
  })

  it('opens the customize popover from the panel item action', () => {
    MockUsePreferenceUtils.mockPreferenceReturn('chat.input.toolbar.pinned_tools', [])

    const { result } = renderHook(() => useComposerToolbarPinnedTools('chat.input.toolbar.pinned_tools'))

    expect(result.current.customizeOpen).toBe(false)
    expect(result.current.customizePanelItem.label).toBe('chat.input.toolbar.customize')

    act(() => {
      result.current.customizePanelItem.action?.({} as never)
    })
    expect(result.current.customizeOpen).toBe(true)

    act(() => {
      result.current.setCustomizeOpen(false)
    })
    expect(result.current.customizeOpen).toBe(false)
  })
})
