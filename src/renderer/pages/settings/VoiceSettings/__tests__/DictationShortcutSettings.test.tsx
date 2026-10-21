import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandSharedPreferencesContext, ContextKeySnapshotContext } from '@renderer/hooks/command'

import { DictationShortcutSettings } from '../DictationShortcutSettings'

vi.unmock('@cherrystudio/ui')

describe('dictation shortcut settings', () => {
  let user: ReturnType<typeof userEvent.setup>
  beforeEach(async () => {
    user = userEvent.setup()
    await i18n.changeLanguage('en-US')
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.hold_shortcut', 'AltLeft')
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.toggle_shortcut', 'AltLeft+ControlLeft')
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.mouse_hold_enabled', true)
  })
  it('shows mouse hold enabled and saves the toggle', async () => {
    render(<DictationShortcutSettings />)
    const toggle = screen.getByRole('switch', { name: 'Press and hold the mouse to dictate' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await user.click(toggle)
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.mouse_hold_enabled')).toBe(false)
    )
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
    await user.click(hold)
    for (const code of ['ControlLeft', 'ShiftLeft', 'KeyA']) fireEvent.keyDown(hold, { code, key: code })
    fireEvent.keyUp(hold, { code: 'KeyA', key: 'a', ctrlKey: true, shiftKey: true })
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
    await user.click(hold)
    fireEvent.keyDown(hold, { key: 'Alt', code: 'AltRight' })
    fireEvent.keyUp(hold, { key: 'Alt', code: 'AltRight' })
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe('AltRight')
    )
  })
  it('rejects multiple non-modifier keys instead of overlooking a command shortcut', async () => {
    render(<DictationShortcutSettings />)
    const hold = screen.getByRole('button', { name: 'Long press' })
    await user.click(hold)
    for (const code of ['ControlLeft', 'KeyW', 'KeyB']) fireEvent.keyDown(hold, { code, key: code })
    fireEvent.keyUp(hold, { code: 'KeyB', key: 'b' })
    expect(screen.getByRole('alert')).toHaveTextContent('at most one non-modifier key')
    expect(hold).toHaveAttribute('aria-pressed', 'false')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe('AltLeft')
  })

  it.each(['hold', 'toggle'] as const)(
    'rejects a %s binding that forms an enabled command before completion',
    async (mode) => {
      render(<DictationShortcutSettings />)
      const button = screen.getByRole('button', { name: mode === 'hold' ? 'Long press' : 'Short press' })
      const original = MockUsePreferenceUtils.getPreferenceValue(`feature.voice.dictation.${mode}_shortcut`)
      await user.click(button)
      fireEvent.keyDown(button, { code: 'ControlLeft', key: 'Control', ctrlKey: true })
      fireEvent.keyDown(button, { code: 'KeyW', key: 'w', ctrlKey: true })
      fireEvent.keyDown(button, { code: 'AltLeft', key: 'Alt', ctrlKey: true, altKey: true })
      fireEvent.keyUp(button, { code: 'AltLeft', key: 'Alt', ctrlKey: true })
      expect(screen.getByRole('alert')).toHaveTextContent('already in use')
      expect(MockUsePreferenceUtils.getPreferenceValue(`feature.voice.dictation.${mode}_shortcut`)).toBe(original)
    }
  )

  it('allows a combination when its constituent command is disabled', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.toggle_shortcut', '')
    render(
      <CommandSharedPreferencesContext
        value={{
          shortcutPreferences: { 'tab.close': { binding: ['CommandOrControl', 'W'], enabled: false } },
          menuPresentationMode: undefined
        }}>
        <DictationShortcutSettings />
      </CommandSharedPreferencesContext>
    )
    const hold = screen.getByRole('button', { name: 'Long press' })
    await user.click(hold)
    fireEvent.keyDown(hold, { code: 'ControlLeft', key: 'Control', ctrlKey: true })
    fireEvent.keyDown(hold, { code: 'KeyW', key: 'w', ctrlKey: true })
    fireEvent.keyDown(hold, { code: 'AltLeft', key: 'Alt', ctrlKey: true, altKey: true })
    fireEvent.keyUp(hold, { code: 'AltLeft', key: 'Alt', ctrlKey: true })
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe(
        'AltLeft+ControlLeft+KeyW'
      )
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each(['ControlLeft', 'MetaLeft'])('does not save a stale %s after its release was intercepted', async (code) => {
    render(<DictationShortcutSettings />)
    const hold = screen.getByRole('button', { name: 'Long press' })
    await user.click(hold)
    fireEvent.keyDown(hold, { code, key: code, ctrlKey: code === 'ControlLeft', metaKey: code === 'MetaLeft' })
    // A main-process accelerator can consume the next keydown and subsequent releases.
    fireEvent.keyDown(hold, { code: 'ShiftLeft', key: 'Shift', shiftKey: true })
    fireEvent.keyUp(hold, { code: 'ShiftLeft', key: 'Shift' })
    expect(screen.getByRole('alert')).toHaveTextContent('Use up to 3 keys')
    expect(hold).toHaveAttribute('aria-pressed', 'false')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe('AltLeft')
  })

  it('rejects combining both sides of one modifier instead of masking an intercepted release', async () => {
    render(<DictationShortcutSettings />)
    const hold = screen.getByRole('button', { name: 'Long press' })
    await user.click(hold)
    fireEvent.keyDown(hold, { code: 'ControlLeft', key: 'Control', ctrlKey: true })
    fireEvent.keyDown(hold, { code: 'ControlRight', key: 'Control', ctrlKey: true })
    fireEvent.keyDown(hold, { code: 'ShiftLeft', key: 'Shift', ctrlKey: true, shiftKey: true })
    fireEvent.keyUp(hold, { code: 'ShiftLeft', key: 'Shift', ctrlKey: true })
    expect(screen.getByRole('alert')).toHaveTextContent('Use up to 3 keys')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe('AltLeft')
  })

  it.each([['ControlLeft', 'AltLeft', 'ShiftLeft', 'MetaLeft'], ['KeyA'], ['F8']])(
    'rejects unsupported key sets %j',
    async (...codes) => {
      render(<DictationShortcutSettings />)
      const hold = screen.getByRole('button', { name: 'Long press' })
      await user.click(hold)
      for (const code of codes) fireEvent.keyDown(hold, { code, key: code })
      fireEvent.keyUp(hold, { code: codes.at(-1), key: codes.at(-1) })
      expect(screen.getByRole('alert')).toHaveTextContent('Use up to 3 keys')
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe('AltLeft')
    }
  )

  it.each(['[Enter]', '[Space]'])(
    'enters shortcut recording with %s and ignores its activation release',
    async (key) => {
      render(<DictationShortcutSettings />)
      const hold = screen.getByRole('button', { name: 'Long press' })
      hold.focus()
      await user.keyboard(key)
      expect(hold).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByRole('alert')).toBeNull()
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe('AltLeft')
    }
  )

  it('cancels shortcut recording when the window loses focus', async () => {
    render(<DictationShortcutSettings />)
    const hold = screen.getByRole('button', { name: 'Long press' })
    await user.click(hold)
    fireEvent.keyDown(hold, { code: 'AltRight', key: 'Alt' })
    fireEvent.blur(window)
    fireEvent.keyUp(hold, { code: 'AltRight', key: 'Alt' })
    expect(hold).toHaveAttribute('aria-pressed', 'false')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe('AltLeft')
  })

  it('rejects an identical binding and preserves the existing shortcut', async () => {
    render(<DictationShortcutSettings />)
    const toggle = screen.getByRole('button', { name: 'Short press' })
    await user.click(toggle)
    fireEvent.keyDown(toggle, { key: 'Alt', code: 'AltLeft' })
    fireEvent.keyUp(toggle, { key: 'Alt', code: 'AltLeft' })
    expect(screen.getByRole('alert')).toHaveTextContent('already in use')
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.toggle_shortcut')).toBe(
      'AltLeft+ControlLeft'
    )
  })
  it.each(['hold', 'toggle'] as const)('rejects a %s edit that makes hold extend toggle', async (mode) => {
    if (mode === 'toggle') {
      MockUsePreferenceUtils.setPreferenceValue(
        'feature.voice.dictation.hold_shortcut',
        'AltLeft+ControlLeft+ShiftLeft'
      )
      MockUsePreferenceUtils.setPreferenceValue('feature.voice.dictation.toggle_shortcut', 'AltRight+ControlRight')
    }
    render(<DictationShortcutSettings />)
    const button = screen.getByRole('button', { name: mode === 'hold' ? 'Long press' : 'Short press' })
    const original = MockUsePreferenceUtils.getPreferenceValue(`feature.voice.dictation.${mode}_shortcut`)
    await user.click(button)
    fireEvent.keyDown(button, { code: 'ControlLeft', key: 'Control', ctrlKey: true })
    fireEvent.keyDown(button, { code: 'AltLeft', key: 'Alt', ctrlKey: true, altKey: true })
    if (mode === 'hold') {
      fireEvent.keyDown(button, { code: 'ShiftLeft', key: 'Shift', ctrlKey: true, altKey: true, shiftKey: true })
      fireEvent.keyUp(button, { code: 'ShiftLeft', key: 'Shift', ctrlKey: true, altKey: true })
    } else {
      fireEvent.keyUp(button, { code: 'AltLeft', key: 'Alt', ctrlKey: true })
    }
    expect(screen.getByRole('alert')).toHaveTextContent('already in use')
    expect(MockUsePreferenceUtils.getPreferenceValue(`feature.voice.dictation.${mode}_shortcut`)).toBe(original)
  })
  it('clears a shortcut and leaves Escape as a recording cancellation', async () => {
    render(<DictationShortcutSettings />)
    const hold = screen.getByRole('button', { name: 'Long press' })
    await user.click(hold)
    fireEvent.keyDown(hold, { key: 'Escape', code: 'Escape' })
    expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe('AltLeft')
    await user.click(screen.getByRole('button', { name: 'Clear Long press' }))
    await waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('feature.voice.dictation.hold_shortcut')).toBe('')
    )
  })
})
