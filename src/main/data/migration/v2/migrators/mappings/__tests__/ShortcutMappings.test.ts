import { describe, expect, it, vi } from 'vitest'

import { transformShortcuts } from '../ShortcutMappings'

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
      'shortcut.feature.quick_assistant.toggle_window': {
        binding: ['CommandOrControl', 'E'],
        enabled: false
      },
      'shortcut.general.show_settings': {
        binding: ['CommandOrControl', ','],
        enabled: true
      },
      'shortcut.feature.selection.toggle_enabled': {
        binding: [],
        enabled: false
      }
    })
  })

  it('prefers the renamed toggle_sidebar key over toggle_show_assistants', () => {
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

    expect(result['shortcut.general.toggle_sidebar']).toEqual({
      binding: ['CommandOrControl', 'Shift', '['],
      enabled: false
    })
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

    expect(result['shortcut.general.show_settings']).toEqual({
      binding: ['CommandOrControl', ','],
      enabled: true
    })
  })

  it('returns an empty result for non-array legacy sources', () => {
    expect(transformShortcuts({ shortcuts: 'nope' })).toEqual({})
  })
})
