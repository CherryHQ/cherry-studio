import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandSharedPreferencesContext, ContextKeySnapshotContext } from '@renderer/hooks/command'

import { DictationShortcutSettings } from '../DictationShortcutSettings'

vi.unmock('@cherrystudio/ui')

describe('dictation shortcut settings', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'AltLeft')
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.toggle_shortcut', 'AltLeft+ControlLeft')
  })
  it.each([false, true])('respects whether a configured screenshot shortcut is enabled (%s)', async (enabled) => {
    render(
      <ContextKeySnapshotContext value={new Map([['feature.screenshot.enabled', enabled]])}>
        <CommandSharedPreferencesContext
          value={{
            shortcutPreferences: {
              'screenshot.capture': { binding: ['CommandOrControl', 'Shift', 'A'], enabled: true }
            },
            menuPresentationMode: undefined
          }}>
          <DictationShortcutSettings />
        </CommandSharedPreferencesContext>
      </ContextKeySnapshotContext>
    )
    const hold = screen.getByRole('button', { name: 'Long press' })
    fireEvent.click(hold)
    for (const code of ['ControlLeft', 'ShiftLeft', 'KeyA']) fireEvent.keyDown(hold, { code, key: code })
    fireEvent.keyUp(hold, { code: 'KeyA', key: 'a' })
    if (enabled) {
      expect(screen.getByRole('alert')).toHaveTextContent('already in use')
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe('AltLeft')
    } else {
      await waitFor(() =>
        expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe(
          'ControlLeft+KeyA+ShiftLeft'
        )
      )
      expect(screen.queryByRole('alert')).toBeNull()
    }
  })
  it('shows the requested defaults and saves a sided modifier shortcut', async () => {
    render(<DictationShortcutSettings />)
    const hold = screen.getByRole('button', { name: 'Long press' })
    expect(hold).toHaveTextContent('Left Alt')
    expect(screen.getByRole('button', { name: 'Short press' })).toHaveTextContent('Left Ctrl + Left Alt')
    fireEvent.click(hold)
    fireEvent.keyDown(hold, { key: 'Alt', code: 'AltRight' })
    fireEvent.keyUp(hold, { key: 'Alt', code: 'AltRight' })
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe('AltRight')
    )
  })
  it('rejects an identical binding and preserves the existing shortcut', () => {
    render(<DictationShortcutSettings />)
    const toggle = screen.getByRole('button', { name: 'Short press' })
    fireEvent.click(toggle)
    fireEvent.keyDown(toggle, { key: 'Alt', code: 'AltLeft' })
    fireEvent.keyUp(toggle, { key: 'Alt', code: 'AltLeft' })
    expect(screen.getByRole('alert')).toHaveTextContent('already in use')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.toggle_shortcut')).toBe(
      'AltLeft+ControlLeft'
    )
  })
  it('clears a shortcut and leaves Escape as a recording cancellation', async () => {
    render(<DictationShortcutSettings />)
    const hold = screen.getByRole('button', { name: 'Long press' })
    fireEvent.click(hold)
    fireEvent.keyDown(hold, { key: 'Escape', code: 'Escape' })
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe('AltLeft')
    fireEvent.click(screen.getByRole('button', { name: 'Clear Long press' }))
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe('')
    )
  })
})
