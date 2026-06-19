import { describe, expect, it } from 'vitest'

import { parseContextExpr } from '../contextExpr'
import {
  type CommandId,
  commandShortcutPreferenceKey,
  findCommandDefinition,
  KEYBINDING_RULES,
  REGISTERED_COMMANDS,
  REGISTERED_KEYBINDINGS
} from '../definitions'
import {
  findKeybindingConflicts,
  getCommandDefaultShortcutPreference,
  resolveCommandByKeybinding,
  resolveCommandKeybinding,
  resolveCommandShortcutPreference
} from '../keybindings'
import type { RegisteredKeybindingRule } from '../types'

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

  it('derives keybinding rules from command definitions', () => {
    expect(KEYBINDING_RULES).toHaveLength(REGISTERED_COMMANDS.length)

    for (const rule of REGISTERED_KEYBINDINGS) {
      const command = findCommandDefinition(rule.command)

      expect(command, `missing command definition for ${rule.command}`).toBeDefined()
      expect(rule.scope).toBe(command?.scope)
      expect(rule.preferenceKey).toBe(`shortcut.${rule.command}`)
    }
  })

  it('preserves special keybinding metadata when deriving rules', () => {
    expect(REGISTERED_KEYBINDINGS.find((rule) => rule.command === 'quick_assistant.toggle')).toMatchObject({
      command: 'quick_assistant.toggle',
      defaultBinding: ['CommandOrControl', 'E'],
      global: true,
      scope: 'main',
      whenSource: 'feature.quick_assistant.enabled'
    })
    expect(REGISTERED_KEYBINDINGS.find((rule) => rule.command === 'selection.toggle')).toMatchObject({
      command: 'selection.toggle',
      defaultBinding: [],
      global: true,
      scope: 'main',
      supportedPlatforms: ['darwin', 'win32', 'linux'],
      whenSource: 'feature.selection.enabled'
    })
    expect(REGISTERED_KEYBINDINGS.find((rule) => rule.command === 'app.zoom.in')).toMatchObject({
      command: 'app.zoom.in',
      defaultBinding: ['CommandOrControl', '='],
      additionalBindings: [['CommandOrControl', 'numadd']]
    })
    expect(REGISTERED_KEYBINDINGS.find((rule) => rule.command === 'app.zoom.out')).toMatchObject({
      command: 'app.zoom.out',
      defaultBinding: ['CommandOrControl', '-'],
      additionalBindings: [['CommandOrControl', 'numsub']]
    })
  })

  it('resolves commands by id', () => {
    expect(findCommandDefinition('topic.create')?.titleKey).toBe('settings.shortcuts.new_topic')
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
    expect(resolveCommandShortcutPreference('chat.message.search', undefined)).toEqual({
      binding: ['CommandOrControl', 'F'],
      enabled: true
    })
    expect(resolveCommandShortcutPreference('chat.message.search', { binding: [], enabled: true })?.binding).toEqual([])
    expect(resolveCommandShortcutPreference('chat.message.search', { binding: ['Alt', 'L'], enabled: false })).toEqual({
      binding: ['Alt', 'L'],
      enabled: false
    })
  })
})

describe('resolveCommandKeybinding', () => {
  it('uses default binding when no preference exists', () => {
    const resolved = resolveCommandKeybinding({
      command: 'topic.create',
      context: {},
      platform: 'darwin'
    })

    expect(resolved?.binding).toEqual(['CommandOrControl', 'N'])
    expect(resolved?.accelerator).toBe('CommandOrControl+N')
  })

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
        command: 'quick_assistant.toggle',
        context: { 'feature.quick_assistant.enabled': true }
      })?.binding
    ).toEqual(['CommandOrControl', 'E'])
    expect(
      resolveCommandKeybinding({
        command: 'quick_assistant.toggle',
        context: { 'feature.quick_assistant.enabled': true }
      })?.enabled
    ).toBe(false)

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
  it('resolves primary bindings to commands', () => {
    expect(
      resolveCommandByKeybinding({
        binding: ['CommandOrControl', 'N'],
        context: {},
        platform: 'darwin',
        scope: 'renderer'
      })
    ).toBe('topic.create')
  })

  it('resolves additional bindings without changing the primary display binding', () => {
    expect(
      resolveCommandByKeybinding({
        binding: ['CommandOrControl', 'numadd'],
        context: {},
        platform: 'darwin',
        scope: 'main'
      })
    ).toBe('app.zoom.in')
  })

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

  it('keeps matching stable for identical bindings by registry order and context', () => {
    expect(
      resolveCommandByKeybinding({
        binding: ['CommandOrControl', 'F'],
        preferences: { 'app.search': { binding: ['CommandOrControl', 'F'], enabled: true } },
        context: {},
        scope: 'renderer'
      })
    ).toBe('app.search')
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

  it('ignores conflicts when scope or platform cannot overlap', () => {
    expect(
      findKeybindingConflicts({
        command: 'topic.create',
        preference: { binding: ['CommandOrControl', 'N'], enabled: true },
        preferences: { 'app.settings.open': { binding: ['CommandOrControl', 'N'], enabled: true } },
        rules: [testRule('topic.create'), testRule('app.settings.open', { scope: 'main' })]
      })
    ).toEqual([])

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
      const preference = getCommandDefaultShortcutPreference(rule.command)
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
