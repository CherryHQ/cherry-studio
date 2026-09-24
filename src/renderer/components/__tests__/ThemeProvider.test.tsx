import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTheme } from '@renderer/hooks/useTheme'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

import { ThemeProvider } from '../ThemeProvider'

const ipcMocks = vi.hoisted(() => ({
  request: vi.fn(),
  useIpcOn: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcMocks.request },
  useIpcOn: ipcMocks.useIpcOn
}))

// The entry points await the preference preload before the first render (A2), so the
// saved theme is already in cache when ThemeProvider first mounts. These tests lock the
// second half of that fix: the FIRST committed frame must already use the saved theme —
// deriving it in an effect would commit an OS-theme frame first (the visible flash).

const stubMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  })
}

// Records the theme of every committed render — index 0 is the first frame.
const renderedThemes: ThemeMode[] = []
function ThemeProbe(): null {
  const { theme } = useTheme()
  renderedThemes.push(theme)
  return null
}

describe('ThemeProvider first frame', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    // useUserTheme feeds Color() from this key during render — must be a real color.
    MockUsePreferenceUtils.setPreferenceValue('ui.theme_user.color_primary', '#00b96b')
    ipcMocks.request.mockReset()
    ipcMocks.request.mockResolvedValue(ThemeMode.dark)
    ipcMocks.useIpcOn.mockClear()
    renderedThemes.length = 0
  })

  it('renders the saved theme on the first frame when it differs from the OS theme', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.theme_mode', ThemeMode.dark)
    stubMatchMedia(false) // OS says light

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    )

    expect(renderedThemes[0]).toBe(ThemeMode.dark)
  })

  it('falls back to the OS theme on the first frame when the saved theme is system', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.theme_mode', ThemeMode.system)
    stubMatchMedia(true) // OS says dark

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    )

    expect(renderedThemes[0]).toBe(ThemeMode.dark)
  })

  it('uses Electron resolved theme when the renderer media query disagrees', async () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.theme_mode', ThemeMode.system)
    stubMatchMedia(false)
    ipcMocks.request.mockResolvedValue(ThemeMode.dark)

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    )

    expect(renderedThemes[0]).toBe(ThemeMode.light)
    await waitFor(() => expect(renderedThemes.at(-1)).toBe(ThemeMode.dark))
    expect(ipcMocks.request).toHaveBeenCalledWith('system.get_native_theme')
  })
})
