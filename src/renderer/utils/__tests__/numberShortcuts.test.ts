import { describe, expect, it } from 'vitest'

import { getCommandDefaultShortcutPreference, resolveCommandByKeybinding } from '@shared/utils/command'

import { getNumberShortcutMode, getNumberShortcutPreset, getNumberShortcutUpdates } from '../numberShortcuts'

describe('number shortcut presets', () => {
  it.each(['darwin', 'win32', 'linux'] as const)(
    'swaps all nine conversation and tab positions without collisions on %s',
    (platform) => {
      const secondary = platform === 'darwin' ? 'Ctrl' : 'Alt'
      for (const mode of ['conversation', 'tab'] as const) {
        const preferences = getNumberShortcutPreset(mode, platform)
        for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const) {
          const options = { preferences, platform, context: {}, scope: 'renderer' as const }
          expect(resolveCommandByKeybinding({ ...options, binding: ['CommandOrControl', digit] })).toBe(
            mode === 'conversation' ? `app.sidebar.open_${digit}` : `tab.open_${digit}`
          )
          expect(resolveCommandByKeybinding({ ...options, binding: [secondary, digit] })).toBe(
            mode === 'tab' ? `app.sidebar.open_${digit}` : `tab.open_${digit}`
          )
        }
      }
    }
  )

  it.each(['darwin', 'win32', 'linux'] as const)('disables all number shortcuts on %s', (platform) => {
    const preferences = getNumberShortcutPreset('off', platform)
    expect(Object.values(preferences)).toHaveLength(18)
    expect(Object.values(preferences).every((preference) => preference.enabled === false)).toBe(true)
    for (const [command, preference] of Object.entries(preferences)) {
      expect(preference.binding).toEqual(
        getCommandDefaultShortcutPreference(command as keyof typeof preferences, platform)?.binding
      )
    }
    expect(getNumberShortcutMode(preferences, platform)).toBe('off')
    const updates = getNumberShortcutUpdates('off', platform)
    expect(Object.keys(updates)).toHaveLength(18)
    expect(updates['shortcut.app.sidebar.open_9']?.enabled).toBe(false)
    expect(updates['shortcut.tab.open_9']?.enabled).toBe(false)
    const secondary = platform === 'darwin' ? 'Ctrl' : 'Alt'
    for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const) {
      const options = { preferences, platform, context: {}, scope: 'renderer' as const }
      expect(resolveCommandByKeybinding({ ...options, binding: ['CommandOrControl', digit] })).toBeUndefined()
      expect(resolveCommandByKeybinding({ ...options, binding: [secondary, digit] })).toBeUndefined()
    }
  })

  it('recognizes clean defaults and preserves customized or disabled bindings as custom', () => {
    expect(getNumberShortcutMode({}, 'darwin')).toBe('conversation')
    expect(getNumberShortcutMode(getNumberShortcutPreset('tab', 'darwin'), 'darwin')).toBe('tab')
    expect(getNumberShortcutMode({ 'app.sidebar.open_1': { binding: ['Alt', 'K'], enabled: true } }, 'darwin')).toBe(
      'custom'
    )
    expect(getNumberShortcutMode({ 'tab.open_1': { binding: ['Ctrl', '1'], enabled: false } }, 'darwin')).toBe('custom')
  })

  it('persists both complete families together when a preset is selected', () => {
    const updates = getNumberShortcutUpdates('tab', 'darwin')
    expect(Object.keys(updates)).toHaveLength(18)
    expect(updates['shortcut.app.sidebar.open_9']).toEqual({ binding: ['Ctrl', '9'], enabled: true })
    expect(updates['shortcut.tab.open_9']).toEqual({ binding: ['CommandOrControl', '9'], enabled: true })
  })
})
