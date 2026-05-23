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

    expect(result['shortcut.app.sidebar.toggle']).toEqual({
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

    expect(result['shortcut.app.settings.open']).toEqual({
      binding: ['CommandOrControl', ','],
      enabled: true
    })
  })

  it('skips legacy bindings with unknown key tokens', () => {
    const result = transformShortcuts({
      shortcuts: [
        {
          key: 'show_settings',
          shortcut: ['CommandOrControl', ','],
          enabled: true
        },
        {
          key: 'show_settings',
          shortcut: ['CommandOrControl', 'UnknownKey'],
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
})
