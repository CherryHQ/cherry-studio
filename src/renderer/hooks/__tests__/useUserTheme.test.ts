import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import useUserTheme from '../useUserTheme'

describe('useUserTheme', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    document.documentElement.removeAttribute('style')
  })

  it.each([
    ['#FFFFFF', '#000000'],
    ['#000000', '#FFFFFF'],
    ['#00B96B', '#000000']
  ])('derives a contrast-safe foreground for primary %s', (primary, foreground) => {
    const { result } = renderHook(() => useUserTheme())

    act(() => result.current.initUserTheme({ colorPrimary: primary }))

    expect(document.documentElement.style.getPropertyValue('--cs-theme-primary-foreground')).toBe(foreground)
  })
})
