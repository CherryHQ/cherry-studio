import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import Color from 'color'
import { beforeEach, describe, expect, it } from 'vitest'

import useUserTheme from '../useUserTheme'

const getRootColor = (name: string) => Color(document.documentElement.style.getPropertyValue(name))

describe('useUserTheme', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'ui.theme_user.code_font_family': '',
      'ui.theme_user.color_primary': '#2563eb',
      'ui.theme_user.font_family': ''
    })
    document.body.className = 'light'
    document.documentElement.removeAttribute('style')
  })

  it('preserves an accent that is already readable on the light surface', () => {
    const { result } = renderHook(() => useUserTheme())

    act(() => result.current.initUserTheme())

    expect(getRootColor('--cs-theme-accent-text').hex()).toBe('#2563EB')
  })

  it('adjusts light accents for readable text and chooses a dark on-accent foreground', () => {
    const { result } = renderHook(() => useUserTheme())

    act(() => result.current.initUserTheme({ colorPrimary: '#ffff00' }))

    expect(getRootColor('--cs-theme-accent-text').contrast(Color('#ffffff'))).toBeGreaterThanOrEqual(4.5)
    expect(getRootColor('--cs-theme-accent-foreground').hex()).toBe('#1A1C1F')
  })

  it('adjusts dark accents for readable text on the dark theme surface', () => {
    document.body.className = 'dark'
    const { result } = renderHook(() => useUserTheme())

    act(() => result.current.initUserTheme({ colorPrimary: '#111827' }))

    expect(getRootColor('--cs-theme-accent-text').contrast(Color('#151514'))).toBeGreaterThanOrEqual(4.5)
    expect(getRootColor('--cs-theme-accent-foreground').hex()).toBe('#FFFFFF')
  })
})
