import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useShowWorkspace } from '../useShowWorkspace'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

describe('useShowWorkspace', () => {
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

  it('toggles workspace visibility from the current preference value', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.notes.show_workspace', false)

    const { result } = renderHook(() => useShowWorkspace())

    act(() => {
      result.current.toggleShowWorkspace()
    })

    await waitFor(() => {
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.notes.show_workspace')).toBe(true)
    })
  })

  it('shows an error toast when workspace visibility persistence fails', async () => {
    MockUsePreferenceUtils.mockPreferenceReturn(
      'feature.notes.show_workspace',
      false,
      vi.fn().mockRejectedValue(new Error('persist failed'))
    )

    const { result } = renderHook(() => useShowWorkspace())

    act(() => {
      result.current.toggleShowWorkspace()
    })

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('notes.settings.save_failed')
    })
  })
})
