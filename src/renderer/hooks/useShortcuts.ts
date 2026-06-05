import { useMultiplePreferences } from '@data/hooks/usePreference'
import { platform } from '@renderer/config/constant'
import { useCommandContextReader } from '@renderer/features/command'
import {
  type CommandId,
  type CommandShortcutPreferenceKey,
  evaluateContextExpr,
  findCommandDefinition,
  getCommandDefaultShortcutPreference,
  REGISTERED_KEYBINDINGS,
  resolveCommandShortcutPreference,
  type SupportedPlatform
} from '@shared/command'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { normalizeShortcutBinding } from '@shared/shortcuts/tokens'
import type { ResolvedShortcut } from '@shared/shortcuts/types'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export type ShortcutSettingsGroup = 'general' | 'chat' | 'topic' | 'assistant'
type CommandShortcutKey = CommandShortcutPreferenceKey<CommandId>

const shortcutPreferenceKeyMap = REGISTERED_KEYBINDINGS.reduce<Record<CommandId, CommandShortcutKey>>(
  (acc, rule) => {
    acc[rule.command] = rule.preferenceKey
    return acc
  },
  {} as Record<CommandId, CommandShortcutKey>
)

const commandCategoryToSettingsGroup = (categoryKey: string): ShortcutSettingsGroup => {
  if (categoryKey === 'settings.shortcuts.general') {
    return 'general'
  }
  if (categoryKey === 'settings.shortcuts.chat') {
    return 'chat'
  }
  if (categoryKey === 'settings.shortcuts.topic') {
    return 'topic'
  }
  return 'assistant'
}

const buildNextPreference = (
  state: ResolvedShortcut,
  currentValue: PreferenceShortcutType | undefined,
  patch: Partial<PreferenceShortcutType>
): PreferenceShortcutType => {
  const current: Partial<PreferenceShortcutType> = currentValue ?? {}

  return {
    binding: Array.isArray(patch.binding)
      ? normalizeShortcutBinding(patch.binding)
      : Array.isArray(current.binding)
        ? normalizeShortcutBinding(current.binding)
        : state.binding,
    enabled:
      typeof patch.enabled === 'boolean'
        ? patch.enabled
        : typeof current.enabled === 'boolean'
          ? current.enabled
          : state.enabled
  }
}

export interface ShortcutListItem {
  command: CommandId
  key: CommandShortcutKey
  label: string
  group: ShortcutSettingsGroup
  keybinding: (typeof REGISTERED_KEYBINDINGS)[number]
  preference: ResolvedShortcut
  defaultPreference: ResolvedShortcut
}

export const getAllShortcutDefaultPreferences = (): Record<CommandShortcutKey, PreferenceShortcutType> => {
  return REGISTERED_KEYBINDINGS.reduce(
    (acc, rule) => {
      const defaultPreference = getCommandDefaultShortcutPreference(rule.command)
      if (!defaultPreference) {
        return acc
      }
      acc[rule.preferenceKey] = {
        binding: defaultPreference.binding,
        enabled: defaultPreference.enabled
      }
      return acc
    },
    {} as Record<CommandShortcutKey, PreferenceShortcutType>
  )
}

export const useAllShortcuts = () => {
  const { t } = useTranslation()
  const context = useCommandContextReader()
  const [values, setValues] = useMultiplePreferences(shortcutPreferenceKeyMap)

  const updatePreference = useCallback(
    async (key: CommandShortcutKey, patch: Partial<PreferenceShortcutType>) => {
      const rule = REGISTERED_KEYBINDINGS.find((item) => item.preferenceKey === key)
      if (!rule) return
      const currentValue = values[rule.command] as PreferenceShortcutType | undefined
      const state = resolveCommandShortcutPreference(rule.command, currentValue)
      if (!state) return
      const nextValue = buildNextPreference(state, currentValue, patch)
      await setValues({ [rule.command]: nextValue } as Partial<Record<string, PreferenceShortcutType>>)
    },
    [setValues, values]
  )

  const shortcuts = useMemo(
    () =>
      REGISTERED_KEYBINDINGS.flatMap((rule): ShortcutListItem[] => {
        const command = findCommandDefinition(rule.command)
        if (!command) {
          return []
        }

        const supported = rule.supportedPlatforms
        if (supported && platform && !supported.includes(platform as SupportedPlatform)) {
          return []
        }

        if (!evaluateContextExpr(command.enablement, context) || !evaluateContextExpr(rule.when, context)) {
          return []
        }

        const rawValue = values[rule.command] as PreferenceShortcutType | undefined
        const preference = resolveCommandShortcutPreference(rule.command, rawValue)
        const defaultPreference = getCommandDefaultShortcutPreference(rule.command)
        if (!preference || !defaultPreference) {
          return []
        }

        return [
          {
            command: rule.command,
            key: rule.preferenceKey,
            label: t(command.titleKey),
            group: commandCategoryToSettingsGroup(command.categoryKey),
            keybinding: rule,
            preference: {
              binding: preference.binding,
              enabled: preference.enabled && preference.binding.length > 0
            },
            defaultPreference
          }
        ]
      }),
    [context, t, values]
  )

  return { shortcuts, updatePreference }
}
