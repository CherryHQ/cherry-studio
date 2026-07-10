import { useMultiplePreferences } from '@data/hooks/usePreference'
import { platform } from '@renderer/utils/platform'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { CommandShortcutPreferenceKey, SupportedPlatform } from '@shared/types/command'
import type { ResolvedShortcut } from '@shared/types/shortcut'
import {
  type CommandId,
  evaluateContextExpr,
  findCommandDefinition,
  findKeybindingRule,
  getCommandDefaultShortcutPreference,
  REGISTERED_KEYBINDINGS,
  resolveCommandShortcutPreference
} from '@shared/utils/command'
import { normalizeShortcutBinding } from '@shared/utils/shortcut'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useCommandContextReader } from './useCommandContext'

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

const normalizePlatformBindings = (
  platformBindings: PreferenceShortcutType['platformBindings'] | undefined
): PreferenceShortcutType['platformBindings'] | undefined => {
  if (!platformBindings) {
    return undefined
  }

  const normalized: PreferenceShortcutType['platformBindings'] = {}
  for (const targetPlatform of ['darwin', 'win32', 'linux'] as const) {
    const binding = platformBindings[targetPlatform]
    if (Array.isArray(binding)) {
      normalized[targetPlatform] = normalizeShortcutBinding(binding)
    }
  }
  return Object.keys(normalized).length ? normalized : undefined
}

const normalizeShortcutPreference = (preference: PreferenceShortcutType): PreferenceShortcutType => {
  const platformBindings = normalizePlatformBindings(preference.platformBindings)
  return {
    binding: normalizeShortcutBinding(preference.binding),
    enabled: preference.enabled,
    ...(platformBindings ? { platformBindings } : {})
  }
}

const getCommandDefaultFullPreference = (command: CommandId): PreferenceShortcutType | undefined => {
  const rule = findKeybindingRule(command)
  if (!rule) {
    return undefined
  }

  const defaultValue = DefaultPreferences.default[rule.preferenceKey] as PreferenceShortcutType | undefined
  if (defaultValue) {
    return normalizeShortcutPreference(defaultValue)
  }

  return {
    binding: normalizeShortcutBinding(rule.defaultBinding),
    enabled: true
  }
}

const buildNextPreference = (
  state: ResolvedShortcut,
  currentValue: PreferenceShortcutType | undefined,
  defaultValue: PreferenceShortcutType | undefined,
  patch: Partial<PreferenceShortcutType>
): PreferenceShortcutType => {
  const current: Partial<PreferenceShortcutType> = currentValue ?? {}
  const enabled =
    typeof patch.enabled === 'boolean'
      ? patch.enabled
      : typeof current.enabled === 'boolean'
        ? current.enabled
        : state.enabled

  if (Array.isArray(patch.binding)) {
    const platformBindings = normalizePlatformBindings(patch.platformBindings)
    return {
      binding: normalizeShortcutBinding(patch.binding),
      enabled,
      ...(platformBindings ? { platformBindings } : {})
    }
  }

  const source = currentValue ?? defaultValue
  const platformBindings = normalizePlatformBindings(source?.platformBindings)

  return {
    binding: Array.isArray(source?.binding) ? normalizeShortcutBinding(source.binding) : state.binding,
    enabled,
    ...(platformBindings ? { platformBindings } : {})
  }
}

export interface ShortcutListItem {
  command: CommandId
  key: CommandShortcutKey
  label: string
  group: ShortcutSettingsGroup
  keybinding: (typeof REGISTERED_KEYBINDINGS)[number]
  preference: ResolvedShortcut
  preferenceValue: PreferenceShortcutType
  defaultPreference: ResolvedShortcut
  defaultPreferenceValue: PreferenceShortcutType
}

export const getAllShortcutDefaultPreferences = (): Record<CommandShortcutKey, PreferenceShortcutType> => {
  return REGISTERED_KEYBINDINGS.reduce(
    (acc, rule) => {
      const defaultPreference = getCommandDefaultFullPreference(rule.command)
      if (!defaultPreference) {
        return acc
      }
      acc[rule.preferenceKey] = defaultPreference
      return acc
    },
    {} as Record<CommandShortcutKey, PreferenceShortcutType>
  )
}

export const useCommandShortcuts = () => {
  const { t } = useTranslation()
  const context = useCommandContextReader()
  const [values, setValues] = useMultiplePreferences(shortcutPreferenceKeyMap)
  const currentPlatform = platform as SupportedPlatform | undefined

  const updatePreference = useCallback(
    async (key: CommandShortcutKey, patch: Partial<PreferenceShortcutType>) => {
      const rule = REGISTERED_KEYBINDINGS.find((item) => item.preferenceKey === key)
      if (!rule) return
      const currentValue = values[rule.command] as PreferenceShortcutType | undefined
      const state = resolveCommandShortcutPreference(rule.command, currentValue, currentPlatform)
      if (!state) return
      const defaultValue = getCommandDefaultFullPreference(rule.command)
      const nextValue = buildNextPreference(state, currentValue, defaultValue, patch)
      await setValues({ [rule.command]: nextValue } as Partial<Record<string, PreferenceShortcutType>>)
    },
    [currentPlatform, setValues, values]
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
        const preference = resolveCommandShortcutPreference(rule.command, rawValue, currentPlatform)
        const defaultPreference = getCommandDefaultShortcutPreference(rule.command, currentPlatform)
        const defaultPreferenceValue = getCommandDefaultFullPreference(rule.command)
        if (!preference || !defaultPreference || !defaultPreferenceValue) {
          return []
        }
        const preferenceValue = rawValue ? normalizeShortcutPreference(rawValue) : defaultPreferenceValue

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
            preferenceValue,
            defaultPreference,
            defaultPreferenceValue
          }
        ]
      }),
    [context, currentPlatform, t, values]
  )

  return { shortcuts, updatePreference }
}
