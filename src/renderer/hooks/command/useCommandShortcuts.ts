import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useMultiplePreferences } from '@data/hooks/usePreference'
import { resolveCommandPlatform } from '@renderer/utils/command'
import { platform } from '@renderer/utils/platform'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { CommandShortcutPreferenceKey } from '@shared/types/command'
import type { ResolvedShortcut } from '@shared/types/shortcut'
import {
  type CommandId,
  evaluateContextExpr,
  findCommandDefinition,
  getCommandDefaultShortcutPreference,
  REGISTERED_KEYBINDINGS,
  resolveCommandShortcutPreference
} from '@shared/utils/command'
import { normalizeShortcutBinding } from '@shared/utils/shortcut'

import { useCommandContextReader } from './useCommandContext'

export type ShortcutSettingsGroup = 'general' | 'chat' | 'topic' | 'assistant'

type CommandShortcutKey = CommandShortcutPreferenceKey<CommandId>

const currentPlatform = resolveCommandPlatform(platform)

const shortcutPreferenceKeyMap = Object.fromEntries(
  REGISTERED_KEYBINDINGS.map((rule) => [rule.command, rule.preferenceKey] as const)
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

export const getAllShortcutDefaultPreferences = (): Partial<Record<CommandShortcutKey, PreferenceShortcutType>> => {
  const defaults: Partial<Record<CommandShortcutKey, PreferenceShortcutType>> = {}
  for (const rule of REGISTERED_KEYBINDINGS) {
    const preference = getCommandDefaultShortcutPreference(rule.command, currentPlatform)
    if (!preference) continue

    defaults[rule.preferenceKey] = { binding: preference.binding, enabled: preference.enabled }
  }

  return defaults
}

export const useCommandShortcuts = () => {
  const { t } = useTranslation()
  const context = useCommandContextReader()
  const [values, setValues] = useMultiplePreferences(shortcutPreferenceKeyMap)

  const updatePreference = useCallback(
    async (key: CommandShortcutKey, patch: Partial<PreferenceShortcutType>) => {
      const rule = REGISTERED_KEYBINDINGS.find((item) => item.preferenceKey === key)

      if (!rule) return
      const currentValue = values[rule.command]
      const state = resolveCommandShortcutPreference(rule.command, currentValue, currentPlatform)

      if (!state) return
      const nextValue = buildNextPreference(state, currentValue, patch)
      await setValues({ [rule.command]: nextValue })
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

        if (supported && platform && !supported.some((value) => value === platform)) {
          return []
        }

        if (!evaluateContextExpr(command.enablement, context)) {
          return []
        }

        const rawValue = values[rule.command]
        const preference = resolveCommandShortcutPreference(rule.command, rawValue, currentPlatform)
        const defaultPreference = getCommandDefaultShortcutPreference(rule.command, currentPlatform)

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
