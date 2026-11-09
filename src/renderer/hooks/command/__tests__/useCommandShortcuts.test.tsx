// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'

const mocks = vi.hoisted(() => ({
  preferenceValues: {} as Partial<Record<string, PreferenceShortcutType>>,
  setValues: vi.fn(),
  context: {} as Record<string, boolean>
}))

vi.mock('@renderer/utils/platform', () => ({
  platform: 'darwin'
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [mocks.preferenceValues, mocks.setValues]
}))

vi.mock('@renderer/hooks/command/useCommandContext', () => ({
  useCommandContextReader: () => mocks.context
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { getAllShortcutDefaultPreferences, useCommandShortcuts } from '../useCommandShortcuts'

afterEach(() => {
  mocks.preferenceValues = {}
  mocks.context = {}
  mocks.setValues.mockReset()
})

describe('useCommandShortcuts', () => {
  it('keeps configured shortcuts in settings when their keyboard focus condition is inactive', () => {
    mocks.context = { 'webview.focused': true }
    mocks.preferenceValues = {
      'app.sidebar.open_1': { binding: ['CommandOrControl', 'Alt', '1'], enabled: false }
    }
    const { result } = renderHook(() => useCommandShortcuts())

    expect(result.current.shortcuts.find((item) => item.command === 'app.sidebar.open_1')?.preference).toEqual({
      binding: ['CommandOrControl', 'Alt', '1'],
      enabled: false
    })
  })

  it('retains feature availability filtering independently of keyboard focus', () => {
    mocks.context = { 'feature.selection.enabled': false }
    const { result, rerender } = renderHook(() => useCommandShortcuts())
    expect(result.current.shortcuts.some((item) => item.command === 'selection.toggle')).toBe(false)

    mocks.context = { 'feature.selection.enabled': true, 'webview.focused': true }
    rerender()
    expect(result.current.shortcuts.some((item) => item.command === 'selection.toggle')).toBe(true)
  })

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
