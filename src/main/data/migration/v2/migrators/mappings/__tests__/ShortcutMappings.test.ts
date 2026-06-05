import { REGISTERED_KEYBINDINGS } from '@shared/command'
import { describe, expect, it, vi } from 'vitest'

import { LEGACY_KEY_TO_TARGET_KEY, transformShortcuts } from '../ShortcutMappings'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      warn: vi.fn()
    })
  }
}))

describe('transformShortcuts', () => {
  it('maps legacy shortcut entries into per-key preferences', () => {
    const result = transformShortcuts({
      shortcuts: [
        {
          key: 'mini_window',
          shortcut: ['CommandOrControl', 'E'],
          enabled: false
        },
        {
          key: 'show_settings',
          shortcut: ['CommandOrControl', ','],
          enabled: true
        },
        {
          key: 'selection_assistant_toggle',
          shortcut: [],
          enabled: false
        }
      ]
    })

    expect(result).toEqual({
      'shortcut.quick_assistant.toggle': {
        binding: ['CommandOrControl', 'E'],
        enabled: false
      },
      'shortcut.app.settings.open': {
        binding: ['CommandOrControl', ','],
        enabled: true
      },
      'shortcut.selection.toggle': {
        binding: [],
        enabled: false
      }
    })
  })

  it('prefers the renamed toggle_sidebar key over toggle_show_assistants for the left sidebar shortcut', () => {
    const result = transformShortcuts({
      shortcuts: [
        {
          key: 'toggle_show_assistants',
          shortcut: ['CommandOrControl', '['],
          enabled: true
        },
        {
          key: 'toggle_sidebar',
          shortcut: ['CommandOrControl', 'Shift', '['],
          enabled: false
        }
      ]
    })

    expect(result['shortcut.app.sidebar.toggle']).toEqual({
      binding: ['CommandOrControl', 'Shift', '['],
      enabled: false
    })
    expect(result).not.toHaveProperty('shortcut.general.toggle_sidebar')
    expect(result).not.toHaveProperty('shortcut.general.toggle_left_sidebar')
  })

  it('maps legacy toggle_show_topics to the right sidebar shortcut', () => {
    const result = transformShortcuts({
      shortcuts: [
        {
          key: 'toggle_show_topics',
          shortcut: ['CommandOrControl', ']'],
          enabled: true
        }
      ]
    })

    expect(result).toEqual({
      'shortcut.topic.sidebar.toggle': {
        binding: ['CommandOrControl', ']'],
        enabled: true
      }
    })
    expect(result).not.toHaveProperty('shortcut.topic.toggle_show_topics')
    expect(result).not.toHaveProperty('shortcut.general.toggle_right_sidebar')
  })

  it('skips malformed bindings instead of silently clearing them', () => {
    const result = transformShortcuts({
      shortcuts: [
        {
          key: 'show_settings',
          shortcut: ['CommandOrControl', ','],
          enabled: true
        },
        {
          key: 'show_settings',
          shortcut: ['CommandOrControl', 1],
          enabled: false
        }
      ]
    })

    expect(result['shortcut.app.settings.open']).toEqual({
      binding: ['CommandOrControl', ','],
      enabled: true
    })
  })

  it('returns an empty result for non-array legacy sources', () => {
    expect(transformShortcuts({ shortcuts: 'nope' })).toEqual({})
  })

  it('maps every legacy key to a live command shortcut preference key', () => {
    const registeredPreferenceKeys = new Set(REGISTERED_KEYBINDINGS.map((rule) => rule.preferenceKey))

    for (const [legacyKey, targetKey] of Object.entries(LEGACY_KEY_TO_TARGET_KEY)) {
      if (targetKey == null) continue
      expect(registeredPreferenceKeys, `legacy key "${legacyKey}" maps to dead target "${targetKey}"`).toContain(
        targetKey
      )
    }
  })
})
