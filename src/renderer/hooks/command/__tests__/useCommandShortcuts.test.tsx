// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'

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
  it('collects reset preferences using the current platform default', () => {
    expect(getAllShortcutDefaultPreferences()['shortcut.tab.next']).toEqual({
      binding: ['Ctrl', 'Tab'],
      enabled: true
    })

    expect(getAllShortcutDefaultPreferences()['shortcut.tab.prev']).toEqual({
      binding: ['Ctrl', 'Shift', 'Tab'],
      enabled: true
    })
  })

  it('keeps the platform default binding when only toggling enabled', async () => {
    const { result } = renderHook(() => useCommandShortcuts())

    await act(async () => {
      await result.current.updatePreference('shortcut.tab.next', { enabled: false })
    })

    expect(mocks.setValues).toHaveBeenCalledWith({
      'tab.next': {
        binding: ['Ctrl', 'Tab'],
        enabled: false
      }
    })
  })

  it('persists a user-recorded binding verbatim', async () => {
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
