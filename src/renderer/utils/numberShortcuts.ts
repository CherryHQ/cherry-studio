import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { CommandShortcutPreferenceKey, SupportedPlatform } from '@shared/types/command'
import {
  type CommandId,
  commandShortcutPreferenceKey,
  getCommandDefaultShortcutPreference
} from '@shared/utils/command'
import type { ShortcutModifier } from '@shared/utils/shortcut'

export const CONVERSATION_NUMBER_COMMANDS = [
  'app.sidebar.open_1',
  'app.sidebar.open_2',
  'app.sidebar.open_3',
  'app.sidebar.open_4',
  'app.sidebar.open_5',
  'app.sidebar.open_6',
  'app.sidebar.open_7',
  'app.sidebar.open_8',
  'app.sidebar.open_9'
] as const satisfies readonly CommandId[]

export const TAB_NUMBER_COMMANDS = [
  'tab.open_1',
  'tab.open_2',
  'tab.open_3',
  'tab.open_4',
  'tab.open_5',
  'tab.open_6',
  'tab.open_7',
  'tab.open_8',
  'tab.open_9'
] as const satisfies readonly CommandId[]

export const NUMBER_COMMANDS = [...CONVERSATION_NUMBER_COMMANDS, ...TAB_NUMBER_COMMANDS]
export const isNumberShortcut = (command: CommandId): boolean => NUMBER_COMMANDS.some((id) => id === command)
export type NumberShortcutMode = 'conversation' | 'tab'

export function getNumberShortcutPreset(mode: NumberShortcutMode, platform?: SupportedPlatform) {
  const secondary: ShortcutModifier = platform === 'darwin' ? 'Ctrl' : 'Alt'
  const preferences: Partial<Record<CommandId, PreferenceShortcutType>> = {}
  for (const [index, digit] of (['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const).entries()) {
    preferences[CONVERSATION_NUMBER_COMMANDS[index]] = {
      binding: [mode === 'conversation' ? 'CommandOrControl' : secondary, digit],
      enabled: true
    }
    preferences[TAB_NUMBER_COMMANDS[index]] = {
      binding: [mode === 'tab' ? 'CommandOrControl' : secondary, digit],
      enabled: true
    }
  }
  return preferences
}

export function getNumberShortcutMode(
  preferences: Partial<Record<CommandId, PreferenceShortcutType>>,
  platform?: SupportedPlatform
) {
  for (const mode of ['conversation', 'tab'] as const) {
    const preset = getNumberShortcutPreset(mode, platform)
    if (
      NUMBER_COMMANDS.every((command) => {
        const actual = preferences[command] ?? getCommandDefaultShortcutPreference(command, platform)
        const expected = preset[command]
        return (
          actual?.enabled &&
          actual.binding.length === expected?.binding.length &&
          actual.binding.every((token, index) => token === expected.binding[index])
        )
      })
    )
      return mode
  }
  return 'custom'
}

export function getNumberShortcutUpdates(mode: NumberShortcutMode, platform?: SupportedPlatform) {
  const preset = getNumberShortcutPreset(mode, platform)
  const updates: Partial<Record<CommandShortcutPreferenceKey<CommandId>, PreferenceShortcutType>> = {}
  for (const command of NUMBER_COMMANDS) {
    const preference = preset[command]
    if (preference) updates[commandShortcutPreferenceKey(command)] = preference
  }
  return updates
}
