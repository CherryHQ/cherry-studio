import { describe, expect, it, vi } from 'vitest'

import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { REGISTERED_KEYBINDINGS, resolveCommandShortcutPreference } from '@shared/utils/command'
import { normalizeShortcutBinding } from '@shared/utils/shortcut'

import { LEGACY_KEY_TO_TARGET_KEY, transformShortcuts } from '../ShortcutMappings'

const readMigratedShortcut = (value: unknown): PreferenceShortcutType => {
  if (!value || typeof value !== 'object') throw new Error('expected a migrated shortcut')
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.binding) || typeof record.enabled !== 'boolean') {
    throw new Error('expected a migrated shortcut')
  }
  const binding = normalizeShortcutBinding(record.binding)
  if (binding.length !== record.binding.length) throw new Error('expected a shortcut binding')
  return {
    binding,
    enabled: record.enabled,
    ...(typeof record.customized === 'boolean' ? { customized: record.customized } : {})
  }
}

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
        },
        {
          key: 'toggle_new_context',
          shortcut: ['CommandOrControl', 'Alt', 'K'],
          enabled: true
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
      },
      'shortcut.chat.context.toggle_new': {
        binding: ['CommandOrControl', 'Alt', 'K'],
        enabled: true
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
      customized: true,
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
        customized: true,
        enabled: true
      }
    })
    expect(
      resolveCommandShortcutPreference(
        'topic.sidebar.toggle',
        readMigratedShortcut(result['shortcut.topic.sidebar.toggle']),
        'darwin'
      )?.binding
    ).toEqual(['CommandOrControl', ']'])
    expect(result).not.toHaveProperty('shortcut.topic.toggle_show_topics')
    expect(result).not.toHaveProperty('shortcut.general.toggle_right_sidebar')
  })

  it('keeps v1 sidebar defaults and custom chords without adopting the macOS platform chord', () => {
    const result = transformShortcuts({
      shortcuts: [
        { key: 'toggle_show_assistants', shortcut: ['CommandOrControl', '['], enabled: true },
        { key: 'toggle_show_topics', shortcut: ['Command', ']'], enabled: false },
        { key: 'show_settings', shortcut: ['CommandOrControl', ','], enabled: true }
      ]
    })

    expect(result['shortcut.app.sidebar.toggle']).toEqual({
      binding: ['CommandOrControl', '['],
      customized: true,
      enabled: true
    })
    expect(result['shortcut.topic.sidebar.toggle']).toEqual({
      binding: ['Command', ']'],
      customized: true,
      enabled: false
    })
    expect(result['shortcut.app.settings.open']).toEqual({
      binding: ['CommandOrControl', ','],
      enabled: true
    })

    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(
        resolveCommandShortcutPreference(
          'app.sidebar.toggle',
          readMigratedShortcut(result['shortcut.app.sidebar.toggle']),
          platform
        )?.binding
      ).toEqual(['CommandOrControl', '['])
      expect(
        resolveCommandShortcutPreference(
          'topic.sidebar.toggle',
          readMigratedShortcut(result['shortcut.topic.sidebar.toggle']),
          platform
        )?.binding
      ).toEqual(['Command', ']'])
    }
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
