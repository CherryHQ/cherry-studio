import { describe, expect, it } from 'vitest'

import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { RegisteredKeybindingRule } from '@shared/types/command'

import { parseContextExpr } from '../contextExpr'
import {
  type CommandId,
  commandShortcutPreferenceKey,
  findCommandDefinition,
  REGISTERED_COMMANDS,
  REGISTERED_KEYBINDINGS
} from '../definitions'
import {
  findKeybindingConflicts,
  getCommandAccelerator,
  getCommandDefaultShortcutPreference,
  resolveCommandByKeybinding,
  resolveCommandKeybinding,
  resolveCommandShortcutPreference
} from '../keybindings'

const testRule = (
  command: CommandId,
  patch: Partial<RegisteredKeybindingRule<CommandId>> = {}
): RegisteredKeybindingRule<CommandId> => ({
  command,
  defaultBinding: ['CommandOrControl', 'N'],
  scope: 'renderer',
  preferenceKey: commandShortcutPreferenceKey(command),
  ...patch
})

describe('command definitions', () => {
  it('has a keybinding rule for every command', () => {
    const keybindingCommands = new Set(REGISTERED_KEYBINDINGS.map((rule) => rule.command))

    for (const command of REGISTERED_COMMANDS) {
      expect(keybindingCommands.has(command.id), `missing keybinding for ${command.id}`).toBe(true)
    }
  })

  it('binds permanent delete to CommandOrControl+Backspace', () => {
    expect(findCommandDefinition('resource.delete_permanently')).toMatchObject({
      id: 'resource.delete_permanently',
      scope: 'renderer',
      titleKey: 'settings.shortcuts.delete_current_list_item'
    })
    expect(getCommandDefaultShortcutPreference('resource.delete_permanently')).toEqual({
      binding: ['CommandOrControl', 'Backspace'],
      enabled: true
    })
    expect(DefaultPreferences.default['shortcut.resource.delete_permanently']).toEqual({
      binding: ['CommandOrControl', 'Backspace'],
      enabled: true
    })
  })

  // Registration reads the preference default, never the rule: an empty binding there means
  // "the user cleared this", so it is deliberately not backfilled from `defaultBinding`. A rule
  // whose two defaults disagree therefore ships a shortcut that is dead on a fresh install.
  it('ships every declared default binding in the preference defaults', () => {
    for (const rule of REGISTERED_KEYBINDINGS) {
      // `in`, not Array.isArray: ShortcutBinding is a readonly array, which Array.isArray
      // (typed `arg is any[]`) cannot narrow out of the union.
      const declared = 'default' in rule.defaultBinding ? rule.defaultBinding.default : rule.defaultBinding

      expect(DefaultPreferences.default[rule.preferenceKey]?.binding, rule.command).toEqual(declared)
    }
  })
})

describe('commandShortcutPreferenceKey', () => {
  it('uses command ids as shortcut preference keys', () => {
    expect(commandShortcutPreferenceKey('topic.create')).toBe('shortcut.topic.create')
  })
})

describe('command shortcut preferences', () => {
  it('has unique preference keys and schema defaults for every keybinding', () => {
    const keys = REGISTERED_KEYBINDINGS.map((rule) => rule.preferenceKey)
    expect(new Set(keys).size).toBe(keys.length)

    for (const rule of REGISTERED_KEYBINDINGS) {
      const resolved = getCommandDefaultShortcutPreference(rule.command)
      expect(Array.isArray(resolved?.binding), `missing default binding for ${rule.command}`).toBe(true)
      expect(typeof resolved?.enabled, `missing default enabled flag for ${rule.command}`).toBe('boolean')
    }
  })

  it('merges user values with command defaults', () => {
    expect(resolveCommandShortcutPreference('chat.message.search', { binding: [], enabled: true })?.binding).toEqual([])
    expect(resolveCommandShortcutPreference('chat.message.search', { binding: ['Alt', 'L'], enabled: false })).toEqual({
      binding: ['Alt', 'L'],
      enabled: false
    })
  })

  it('lets a user shortcut override the platform-specific default', () => {
    expect(resolveCommandShortcutPreference('tab.next', { binding: ['Alt', 'J'], enabled: true }, 'darwin')).toEqual({
      binding: ['Alt', 'J'],
      enabled: true
    })
    expect(resolveCommandShortcutPreference('tab.next', { binding: [], enabled: true })?.binding).toEqual([])
  })
})

describe('resolveCommandKeybinding', () => {
  it('uses user preference when provided', () => {
    const resolved = resolveCommandKeybinding({
      command: 'topic.create',
      preference: { binding: ['Alt', 'N'], enabled: true },
      context: {},
      platform: 'darwin'
    })

    expect(resolved?.binding).toEqual(['Alt', 'N'])
  })

  it('respects disabled and cleared bindings', () => {
    expect(
      resolveCommandKeybinding({
        command: 'topic.create',
        preference: { binding: ['CommandOrControl', 'N'], enabled: false },
        context: {}
      })?.enabled
    ).toBe(false)

    expect(
      resolveCommandKeybinding({
        command: 'topic.create',
        preference: { binding: [], enabled: true },
        context: {}
      })?.binding
    ).toEqual([])
  })

  it('filters by context and platform', () => {
    expect(resolveCommandKeybinding({ command: 'quick_assistant.toggle', context: {} })).toBeUndefined()

    expect(
      resolveCommandKeybinding({
        command: 'selection.toggle',
        context: { 'feature.selection.enabled': true },
        platform: 'linux'
      })?.binding
    ).toEqual([])
  })
})

describe('resolveCommandByKeybinding', () => {
  it('does not resolve disabled, cleared, unsupported, or unavailable commands', () => {
    expect(
      resolveCommandByKeybinding({
        binding: ['CommandOrControl', 'N'],
        preferences: { 'topic.create': { binding: ['CommandOrControl', 'N'], enabled: false } },
        context: {},
        scope: 'renderer'
      })
    ).toBeUndefined()

    expect(
      resolveCommandByKeybinding({
        binding: ['CommandOrControl', 'N'],
        preferences: { 'topic.create': { binding: [], enabled: true } },
        context: {},
        scope: 'renderer'
      })
    ).toBeUndefined()

    expect(
      resolveCommandByKeybinding({
        binding: ['CommandOrControl', 'E'],
        context: { 'feature.quick_assistant.enabled': true },
        scope: 'main'
      })
    ).toBeUndefined()

    expect(
      resolveCommandByKeybinding({
        binding: ['CommandOrControl', 'E'],
        preferences: { 'quick_assistant.toggle': { binding: ['CommandOrControl', 'E'], enabled: true } },
        context: { 'feature.quick_assistant.enabled': true },
        scope: 'main'
      })
    ).toBe('quick_assistant.toggle')

    expect(
      resolveCommandByKeybinding({
        binding: ['CommandOrControl', 'N'],
        context: {},
        platform: 'linux',
        scope: 'renderer',
        canExecuteCommand: () => false
      })
    ).toBeUndefined()
  })
})

describe('findKeybindingConflicts', () => {
  it('does not report conflicts for the same command', () => {
    expect(
      findKeybindingConflicts({
        command: 'topic.create',
        preference: { binding: ['CommandOrControl', 'N'], enabled: true },
        rules: [testRule('topic.create')]
      })
    ).toEqual([])
  })

  it('reports different commands with the same binding when contexts can overlap', () => {
    expect(
      findKeybindingConflicts({
        command: 'topic.create',
        preference: { binding: ['CommandOrControl', 'N'], enabled: true },
        preferences: { 'app.search': { binding: ['CommandOrControl', 'N'], enabled: true } },
        rules: [testRule('topic.create'), testRule('app.search')]
      })
    ).toEqual([
      expect.objectContaining({
        command: 'topic.create',
        conflictingCommand: 'app.search',
        trigger: 'primary',
        conflictingTrigger: 'primary'
      })
    ])
  })

  it('registers keypad-Enter bindings under the canonical Electron accelerator', () => {
    expect(getCommandAccelerator(['CommandOrControl', 'numenter'])).toBe('CommandOrControl+Enter')
  })

  it('treats keypad Enter and main Return as one trigger when matching', () => {
    expect(
      findKeybindingConflicts({
        command: 'topic.create',
        preference: { binding: ['CommandOrControl', 'numenter'], enabled: true },
        preferences: { 'app.search': { binding: ['CommandOrControl', 'Enter'], enabled: true } },
        rules: [testRule('topic.create'), testRule('app.search')]
      })
    ).toEqual([
      expect.objectContaining({
        command: 'topic.create',
        conflictingCommand: 'app.search'
      })
    ])

    expect(
      findKeybindingConflicts({
        command: 'topic.create',
        preference: { binding: ['CommandOrControl', 'N'], enabled: true },
        preferences: { 'app.search': { binding: ['CommandOrControl', 'numenter'], enabled: true } },
        rules: [testRule('topic.create'), testRule('app.search')]
      })
    ).toEqual([])
  })

  it('reports main-process shortcuts that shadow a renderer binding', () => {
    expect(
      findKeybindingConflicts({
        command: 'topic.create',
        preference: { binding: ['CommandOrControl', '='], enabled: true }
      })
    ).toEqual([
      expect.objectContaining({
        command: 'topic.create',
        conflictingCommand: 'app.zoom.in',
        trigger: 'primary',
        conflictingTrigger: 'primary'
      })
    ])

    expect(
      findKeybindingConflicts({
        command: 'topic.create',
        preference: { binding: ['CommandOrControl', 'Shift', '='], enabled: true }
      })
    ).toEqual([
      expect.objectContaining({
        command: 'topic.create',
        conflictingCommand: 'app.zoom.in',
        trigger: 'primary',
        conflictingTrigger: 'additional'
      })
    ])
  })

  it('ignores conflicts when platforms cannot overlap', () => {
    expect(
      findKeybindingConflicts({
        command: 'topic.create',
        preference: { binding: ['CommandOrControl', 'N'], enabled: true },
        preferences: { 'app.search': { binding: ['CommandOrControl', 'N'], enabled: true } },
        rules: [
          testRule('topic.create', { supportedPlatforms: ['darwin'] }),
          testRule('app.search', { supportedPlatforms: ['win32'] })
        ]
      })
    ).toEqual([])
  })

  it('treats the fixed window-close accelerator as taken on darwin only', () => {
    // The native close role consumes the keys before the renderer sees them, so
    // remapping a command onto it must warn where the app menu exists.
    expect(
      findKeybindingConflicts({
        command: 'topic.create',
        preference: { binding: ['CommandOrControl', 'Shift', 'W'], enabled: true },
        platform: 'darwin'
      })
    ).toEqual([
      expect.objectContaining({
        command: 'topic.create',
        conflictingCommand: 'app.window.close'
      })
    ])

    expect(
      findKeybindingConflicts({
        command: 'topic.create',
        preference: { binding: ['CommandOrControl', 'Shift', 'W'], enabled: true },
        platform: 'win32'
      })
    ).toEqual([])
  })

  it('ignores different commands with mutually exclusive when clauses', () => {
    expect(
      findKeybindingConflicts({
        command: 'topic.create',
        preference: { binding: ['CommandOrControl', 'N'], enabled: true },
        preferences: { 'app.search': { binding: ['CommandOrControl', 'N'], enabled: true } },
        rules: [
          testRule('topic.create', { when: parseContextExpr('chat.active'), whenSource: 'chat.active' }),
          testRule('app.search', { when: parseContextExpr('!chat.active'), whenSource: '!chat.active' })
        ]
      })
    ).toEqual([])
  })

  it('checks additional bindings as trigger bindings', () => {
    expect(
      findKeybindingConflicts({
        command: 'app.zoom.in',
        preference: { binding: ['CommandOrControl', '='], enabled: true },
        preferences: { 'app.search': { binding: ['CommandOrControl', 'numadd'], enabled: true } },
        rules: [
          testRule('app.zoom.in', {
            scope: 'main',
            defaultBinding: ['CommandOrControl', '='],
            additionalBindings: [['CommandOrControl', 'numadd']]
          }),
          testRule('app.search', { scope: 'main', defaultBinding: ['CommandOrControl', 'numadd'] })
        ]
      })
    ).toEqual([
      expect.objectContaining({
        command: 'app.zoom.in',
        conflictingCommand: 'app.search',
        trigger: 'additional',
        conflictingTrigger: 'primary'
      })
    ])
  })

  it('keeps default registered keybindings free of hard conflicts', () => {
    for (const rule of REGISTERED_KEYBINDINGS) {
      const preference = getCommandDefaultShortcutPreference(rule.command, 'darwin')
      if (!preference) continue

      expect(
        findKeybindingConflicts({
          command: rule.command,
          preference,
          platform: 'darwin'
        }),
        `unexpected default conflict for ${rule.command}`
      ).toEqual([])
    }
  })
})
