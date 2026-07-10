// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  preferenceValues: {} as Partial<Record<string, PreferenceShortcutType>>,
  setValues: vi.fn()
}))

vi.mock('@renderer/utils/platform', () => ({
  platform: 'darwin'
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [mocks.preferenceValues, mocks.setValues]
}))

vi.mock('@renderer/hooks/command/useCommandContext', () => ({
  useCommandContextReader: () => ({})
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { getAllShortcutDefaultPreferences, useCommandShortcuts } from '../useCommandShortcuts'

afterEach(() => {
  mocks.preferenceValues = {}
  mocks.setValues.mockReset()
})

describe('useCommandShortcuts', () => {
  it('preserves platform-specific defaults when collecting reset preferences', () => {
    expect(getAllShortcutDefaultPreferences()['shortcut.tab.next']).toEqual({
      binding: ['CommandOrControl', 'Tab'],
      enabled: true,
      platformBindings: { darwin: ['Ctrl', 'Tab'] }
    })

    expect(getAllShortcutDefaultPreferences()['shortcut.tab.prev']).toEqual({
      binding: ['CommandOrControl', 'Shift', 'Tab'],
      enabled: true,
      platformBindings: { darwin: ['Ctrl', 'Shift', 'Tab'] }
    })
  })

  it('preserves platform-specific defaults when only toggling enabled', async () => {
    const { result } = renderHook(() => useCommandShortcuts())

    await act(async () => {
      await result.current.updatePreference('shortcut.tab.next', { enabled: false })
    })

    expect(mocks.setValues).toHaveBeenCalledWith({
      'tab.next': {
        binding: ['CommandOrControl', 'Tab'],
        enabled: false,
        platformBindings: { darwin: ['Ctrl', 'Tab'] }
      }
    })
  })

  it('clears platform-specific bindings when the user records a custom binding', async () => {
    const { result } = renderHook(() => useCommandShortcuts())

    await act(async () => {
      await result.current.updatePreference('shortcut.tab.next', { binding: ['CommandOrControl', 'Alt', 'Tab'] })
    })

    expect(mocks.setValues).toHaveBeenCalledWith({
      'tab.next': {
        binding: ['CommandOrControl', 'Alt', 'Tab'],
        enabled: true
      }
    })
  })
})
