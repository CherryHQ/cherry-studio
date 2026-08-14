import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSidebarFavorites } from '../useSidebarFavorites'

describe('useSidebarFavorites', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('should skip removing a mini app that is not favorited', () => {
    const setFavorites = vi.fn().mockResolvedValue(undefined)
    MockUsePreferenceUtils.mockPreferenceReturn(
      'ui.sidebar.favorites',
      [{ type: 'mini_app', id: 'other-app' }],
      setFavorites
    )

    const { result } = renderHook(() => useSidebarFavorites())

    act(() => {
      result.current.removeMiniApp('missing-app')
    })

    expect(setFavorites).not.toHaveBeenCalled()
  })
})
