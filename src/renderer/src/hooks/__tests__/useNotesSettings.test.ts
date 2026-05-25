import { mockUseMultiplePreferences, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useNotesSettings } from '../useNotesSettings'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

describe('useNotesSettings', () => {
  const toastErrorMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    Object.assign(window, {
      toast: {
        ...window.toast,
        error: toastErrorMock
      }
    })
  })

  it('updates only the requested notes settings fields', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'feature.notes.full_width': false,
      'feature.notes.font_family': 'default',
      'feature.notes.font_size': 14
    })

    const { result } = renderHook(() => useNotesSettings())

    await act(async () => {
      result.current.updateSettings({ fontSize: 18 })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.notes.font_size')).toBe(18)
    })
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.notes.full_width')).toBe(false)
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.notes.font_family')).toBe('default')
  })

  it('shows one error toast when settings persistence fails', async () => {
    mockUseMultiplePreferences.mockReturnValueOnce([
      {
        isFullWidth: false,
        fontFamily: 'default',
        fontSize: 14,
        showTableOfContents: true,
        defaultViewMode: 'edit',
        defaultEditMode: 'preview',
        showTabStatus: true,
        notesPath: '/notes',
        sortType: 'sort_a2z'
      },
      vi.fn().mockRejectedValue(new Error('persist failed'))
    ])

    const { result } = renderHook(() => useNotesSettings())

    act(() => {
      result.current.updateSettings({ fontSize: 18 })
    })

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('notes.settings.save_failed')
    })
  })

  it('persists notes path and sort type through preference keys', async () => {
    const { result } = renderHook(() => useNotesSettings())

    await act(async () => {
      result.current.updateNotesPath('/notes')
      result.current.updateSortType('sort_updated_desc')
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.notes.path')).toBe('/notes')
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.notes.sort_type')).toBe('sort_updated_desc')
    })
  })
})
