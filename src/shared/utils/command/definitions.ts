import type {
  CommandDefinition,
  CommandShortcutPreferenceKey,
  KeybindingRule,
  RegisteredCommandDefinition,
  RegisteredKeybindingRule
} from '@shared/types/command'

import { parseContextExpr } from './contextExpr'

const defineCommand = <const T extends CommandDefinition>(definition: T): T => definition

export const COMMAND_DEFINITIONS = [
  defineCommand({
    id: 'app.fullscreen.exit',
    titleKey: 'settings.shortcuts.exit_fullscreen',
    categoryKey: 'settings.shortcuts.general',
    scope: 'renderer',
    keybinding: {
      defaultBinding: ['Escape'],
      editable: false
    }
  }),
  defineCommand({
    id: 'app.search',
    titleKey: 'settings.shortcuts.search_message',
    categoryKey: 'settings.shortcuts.general',
    scope: 'renderer',
    keybinding: {
      defaultBinding: ['CommandOrControl', 'Shift', 'F']
    }
  }),
  defineCommand({
    id: 'app.sidebar.toggle',
    titleKey: 'settings.shortcuts.toggle_left_sidebar',
    categoryKey: 'settings.shortcuts.topic',
    scope: 'renderer',
    keybinding: {
      defaultBinding: ['CommandOrControl', '[']
    }
  }),
  defineCommand({
    id: 'app.settings.open',
    titleKey: 'settings.shortcuts.show_settings',
    categoryKey: 'settings.shortcuts.general',
    scope: 'main',
    keybinding: {
      defaultBinding: ['CommandOrControl', ','],
      editable: false
    }
  }),
  defineCommand({
    id: 'app.window.show',
    titleKey: 'settings.shortcuts.show_app',
    categoryKey: 'settings.shortcuts.general',
    scope: 'main',
    keybinding: {
      defaultBinding: [],
      global: true
    }
  }),
  defineCommand({
    id: 'app.zoom.in',
    titleKey: 'settings.shortcuts.zoom_in',
    categoryKey: 'settings.shortcuts.general',
    scope: 'main',
    keybinding: {
      defaultBinding: ['CommandOrControl', '='],
      additionalBindings: [['CommandOrControl', 'numadd']],
      editable: false
    }
  }),
  defineCommand({
    id: 'app.zoom.out',
    titleKey: 'settings.shortcuts.zoom_out',
    categoryKey: 'settings.shortcuts.general',
    scope: 'main',
    keybinding: {
      defaultBinding: ['CommandOrControl', '-'],
      additionalBindings: [['CommandOrControl', 'numsub']],
      editable: false
    }
  }),
  defineCommand({
    id: 'app.zoom.reset',
    titleKey: 'settings.shortcuts.zoom_reset',
    categoryKey: 'settings.shortcuts.general',
    scope: 'main',
    keybinding: {
      defaultBinding: ['CommandOrControl', '0'],
      editable: false
    }
  }),
  defineCommand({
    id: 'chat.message.copy_last',
    titleKey: 'settings.shortcuts.copy_last_message',
    categoryKey: 'settings.shortcuts.chat',
    scope: 'renderer',
    keybinding: {
      defaultBinding: ['CommandOrControl', 'Shift', 'C']
    }
  }),
  defineCommand({
    id: 'chat.message.edit_last_user',
    titleKey: 'settings.shortcuts.edit_last_user_message',
    categoryKey: 'settings.shortcuts.chat',
    scope: 'renderer',
    keybinding: {
      defaultBinding: ['CommandOrControl', 'Shift', 'E']
    }
  }),
  defineCommand({
    id: 'chat.message.search',
    titleKey: 'settings.shortcuts.search_message_in_chat',
    categoryKey: 'settings.shortcuts.chat',
    scope: 'renderer',
    keybinding: {
      defaultBinding: ['CommandOrControl', 'F']
    }
  }),
  defineCommand({
    id: 'chat.model.select',
    titleKey: 'settings.shortcuts.select_model',
    categoryKey: 'settings.shortcuts.chat',
    scope: 'renderer',
    keybinding: {
      defaultBinding: ['CommandOrControl', 'Shift', 'M']
    }
  }),
  defineCommand({
    id: 'quick_assistant.toggle',
    titleKey: 'settings.shortcuts.quick_assistant',
    categoryKey: 'settings.shortcuts.feature.quick_assistant',
    scope: 'main',
    enablement: 'feature.quick_assistant.enabled',
    keybinding: {
      defaultBinding: ['CommandOrControl', 'E'],
      global: true,
      when: 'feature.quick_assistant.enabled'
    }
  }),
  defineCommand({
    id: 'selection.capture_text',
    titleKey: 'settings.shortcuts.selection_assistant_select_text',
    categoryKey: 'settings.shortcuts.feature.selection',
    scope: 'main',
    enablement: 'feature.selection.enabled',
    keybinding: {
      defaultBinding: [],
      global: true,
      when: 'feature.selection.enabled',
      supportedPlatforms: ['darwin', 'win32', 'linux']
    }
  }),
  defineCommand({
    id: 'selection.toggle',
    titleKey: 'settings.shortcuts.selection_assistant_toggle',
    categoryKey: 'settings.shortcuts.feature.selection',
    scope: 'main',
    enablement: 'feature.selection.enabled',
    keybinding: {
      defaultBinding: [],
      global: true,
      when: 'feature.selection.enabled',
      supportedPlatforms: ['darwin', 'win32', 'linux']
    }
  }),
  defineCommand({
    id: 'topic.create',
    titleKey: 'settings.shortcuts.new_topic',
    categoryKey: 'settings.shortcuts.topic',
    scope: 'renderer',
    keybinding: {
      defaultBinding: ['CommandOrControl', 'N']
    }
  }),
  defineCommand({
    id: 'topic.rename',
    titleKey: 'settings.shortcuts.rename_topic',
    categoryKey: 'settings.shortcuts.topic',
    scope: 'renderer',
    keybinding: {
      defaultBinding: ['CommandOrControl', 'T']
    }
  }),
  defineCommand({
    id: 'topic.sidebar.toggle',
    titleKey: 'settings.shortcuts.toggle_right_sidebar',
    categoryKey: 'settings.shortcuts.topic',
    scope: 'renderer',
    keybinding: {
      defaultBinding: ['CommandOrControl', ']']
    }
  }),
  defineCommand({
    id: 'tab.close',
    titleKey: 'settings.shortcuts.close_tab',
    categoryKey: 'settings.shortcuts.general',
    scope: 'renderer',
    keybinding: {
      defaultBinding: []
    }
  }),
  defineCommand({
    id: 'tab.pin',
    titleKey: 'settings.shortcuts.pin_tab',
    categoryKey: 'settings.shortcuts.general',
    scope: 'renderer',
    keybinding: {
      defaultBinding: []
    }
  }),
  defineCommand({
    id: 'tab.move-to-first',
    titleKey: 'settings.shortcuts.move_tab_to_first',
    categoryKey: 'settings.shortcuts.general',
    scope: 'renderer',
    keybinding: {
      defaultBinding: []
    }
  }),
  defineCommand({
    id: 'tab.open-in-new-window',
    titleKey: 'settings.shortcuts.open_tab_in_new_window',
    categoryKey: 'settings.shortcuts.general',
    scope: 'renderer',
    keybinding: {
      defaultBinding: []
    }
  })
] as const satisfies readonly CommandDefinition[]

export type CommandId = (typeof COMMAND_DEFINITIONS)[number]['id']

export const commandShortcutPreferenceKey = (command: CommandId): CommandShortcutPreferenceKey<CommandId> =>
  `shortcut.${command}` as CommandShortcutPreferenceKey<CommandId>

export const KEYBINDING_RULES = COMMAND_DEFINITIONS.flatMap((definition) =>
  definition.keybinding
    ? [
        {
          command: definition.id,
          scope: definition.scope,
          ...definition.keybinding
        }
      ]
    : []
) satisfies readonly KeybindingRule<CommandId>[]

const registerCommand = (definition: CommandDefinition<CommandId>): RegisteredCommandDefinition<CommandId> => ({
  id: definition.id,
  titleKey: definition.titleKey,
  categoryKey: definition.categoryKey,
  scope: definition.scope,
  iconKey: definition.iconKey,
  enablement: definition.enablement ? parseContextExpr(definition.enablement) : undefined,
  enablementSource: definition.enablement
})

const registerKeybinding = (rule: KeybindingRule<CommandId>): RegisteredKeybindingRule<CommandId> => ({
  ...rule,
  preferenceKey: commandShortcutPreferenceKey(rule.command),
  when: rule.when ? parseContextExpr(rule.when) : undefined,
  whenSource: rule.when
})

export const REGISTERED_COMMANDS = COMMAND_DEFINITIONS.map(registerCommand)
export const REGISTERED_KEYBINDINGS = KEYBINDING_RULES.map(registerKeybinding)

const commandMap = new Map<CommandId, RegisteredCommandDefinition<CommandId>>(
  REGISTERED_COMMANDS.map((definition) => [definition.id, definition])
)
const keybindingMap = new Map<CommandId, RegisteredKeybindingRule<CommandId>>(
  REGISTERED_KEYBINDINGS.map((rule) => [rule.command, rule])
)

export const findCommandDefinition = (id: CommandId): RegisteredCommandDefinition<CommandId> | undefined =>
  commandMap.get(id)

export const findKeybindingRule = (id: CommandId): RegisteredKeybindingRule<CommandId> | undefined =>
  keybindingMap.get(id)
