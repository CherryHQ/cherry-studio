// @vitest-environment jsdom

import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import Color from 'color'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_COLOR_PRIMARY } from '../../config/constant'
import useUserTheme from '../useUserTheme'

describe('useUserTheme', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    document.documentElement.style.removeProperty('--cs-theme-primary')
  })

  it('falls back to the default primary color when the stored color is invalid', () => {
    mockUsePreference.mockImplementation((key: string) => {
      if (key === 'ui.theme_user.color_primary') {
        return ['NEUTRAL', vi.fn().mockResolvedValue(undefined)]
      }
      return ['', vi.fn().mockResolvedValue(undefined)]
    })

    const { result } = renderHook(() => useUserTheme())

    expect(() => result.current.colorPrimary.toString()).not.toThrow()

    act(() => {
      result.current.initUserTheme()
    })

    expect(document.documentElement.style.getPropertyValue('--cs-theme-primary')).toBe(
      Color(DEFAULT_COLOR_PRIMARY).toString()
    )
  })

  it('passes a valid color through unchanged', () => {
    const validColor = '#ff6600'
    mockUsePreference.mockImplementation((key: string) => {
      if (key === 'ui.theme_user.color_primary') {
        return [validColor, vi.fn().mockResolvedValue(undefined)]
      }
      return ['', vi.fn().mockResolvedValue(undefined)]
    })

    const { result } = renderHook(() => useUserTheme())

    act(() => {
      result.current.initUserTheme()
    })

    expect(document.documentElement.style.getPropertyValue('--cs-theme-primary')).toBe(Color(validColor).toString())
    expect(result.current.colorPrimary.toString()).toBe(Color(validColor).toString())
  })

  it('falls back to the default for an empty stored color', () => {
    mockUsePreference.mockImplementation((key: string) => {
      if (key === 'ui.theme_user.color_primary') {
        return ['', vi.fn().mockResolvedValue(undefined)]
      }
      return ['', vi.fn().mockResolvedValue(undefined)]
    })

    const { result } = renderHook(() => useUserTheme())

    act(() => {
      result.current.initUserTheme()
    })

    expect(document.documentElement.style.getPropertyValue('--cs-theme-primary')).toBe(
      Color(DEFAULT_COLOR_PRIMARY).toString()
    )
    expect(result.current.colorPrimary.toString()).toBe(Color(DEFAULT_COLOR_PRIMARY).toString())
  })

  it('falls back to the default for a whitespace-only stored color', () => {
    mockUsePreference.mockImplementation((key: string) => {
      if (key === 'ui.theme_user.color_primary') {
        return ['   ', vi.fn().mockResolvedValue(undefined)]
      }
      return ['', vi.fn().mockResolvedValue(undefined)]
    })

    const { result } = renderHook(() => useUserTheme())

    act(() => {
      result.current.initUserTheme()
    })

    expect(document.documentElement.style.getPropertyValue('--cs-theme-primary')).toBe(
      Color(DEFAULT_COLOR_PRIMARY).toString()
    )
    expect(result.current.colorPrimary.toString()).toBe(Color(DEFAULT_COLOR_PRIMARY).toString())
  })
})
