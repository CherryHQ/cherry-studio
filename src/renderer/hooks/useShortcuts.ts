import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { isMac, platform } from '@renderer/config/constant'
import { getShortcutLabel } from '@renderer/i18n/label'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { findShortcutDefinition, SHORTCUT_DEFINITIONS } from '@shared/shortcuts/definitions'
import type {
  ResolvedShortcut,
  ShortcutDependencyPreferenceKey,
  ShortcutKey,
  ShortcutPreferenceKey,
  SupportedPlatform
} from '@shared/shortcuts/types'
import {
  convertAcceleratorToHotkey,
  formatShortcutDisplay,
  getDefaultShortcut,
  isShortcutDefinitionEnabled,
  resolveShortcutPreference
} from '@shared/shortcuts/utils'
import { useCallback, useMemo, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

interface UseShortcutOptions {
  preventDefault?: boolean
  enableOnFormTags?: boolean
  enabled?: boolean
  description?: string
  enableOnContentEditable?: boolean
}

const defaultOptions: UseShortcutOptions = {
  preventDefault: true,
  enableOnFormTags: true,
  enabled: true,
  enableOnContentEditable: false
}

const isFullKey = (key: string): key is ShortcutPreferenceKey => key.startsWith('shortcut.')

const toFullKey = (key: ShortcutKey | ShortcutPreferenceKey): ShortcutPreferenceKey =>
  isFullKey(key) ? key : (`shortcut.${key}` as ShortcutPreferenceKey)

const shortcutPreferenceKeyMap = SHORTCUT_DEFINITIONS.reduce<Record<string, ShortcutPreferenceKey>>(
  (acc, definition) => {
    acc[definition.key] = definition.key
    return acc
  },
  {}
)

const shortcutDependencyPreferenceKeyMap = SHORTCUT_DEFINITIONS.reduce<Record<string, ShortcutDependencyPreferenceKey>>(
  (acc, definition) => {
    if (definition.enabledWhen) {
      acc[definition.enabledWhen] = definition.enabledWhen
    }
    return acc
  },
  {}
)

const buildNextPreference = (
  state: ResolvedShortcut,
  currentValue: PreferenceShortcutType | undefined,
  patch: Partial<PreferenceShortcutType>
): PreferenceShortcutType => {
  const current: Partial<PreferenceShortcutType> = currentValue ?? {}

  return {
    binding: Array.isArray(patch.binding)
      ? patch.binding
      : Array.isArray(current.binding)
        ? current.binding
        : state.binding,
    enabled:
      typeof patch.enabled === 'boolean'
        ? patch.enabled
        : typeof current.enabled === 'boolean'
          ? current.enabled
          : state.enabled
  }
}

export const useShortcut = (
  shortcutKey: ShortcutKey | ShortcutPreferenceKey,
  callback: (event: KeyboardEvent) => void,
  options: UseShortcutOptions = defaultOptions
) => {
  const fullKey = toFullKey(shortcutKey)
  const definition = findShortcutDefinition(fullKey)
  const [preference] = usePreference(fullKey)
  const resolved = definition ? resolveShortcutPreference(definition, preference) : null

  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const optionsRef = useRef(options)
  optionsRef.current = options
  const isExternallyEnabled = options.enabled !== false

  const hotkey = useMemo(() => {
    if (!definition || !resolved) {
      return 'none'
    }

    if (!isExternallyEnabled) {
      return 'none'
    }

    if (definition.scope === 'main') {
      return 'none'
    }

    if (!resolved.enabled) {
      return 'none'
    }

    if (!resolved.binding.length) {
      return 'none'
    }

    return convertAcceleratorToHotkey(resolved.binding)
  }, [definition, isExternallyEnabled, resolved])

  useHotkeys(
    hotkey,
    (event) => {
      if (optionsRef.current.preventDefault) {
        event.preventDefault()
      }
      if (optionsRef.current.enabled !== false) {
        callbackRef.current(event)
      }
    },
    {
      enableOnFormTags: optionsRef.current.enableOnFormTags,
      description: optionsRef.current.description ?? fullKey,
      enabled: isExternallyEnabled && hotkey !== 'none',
      enableOnContentEditable: optionsRef.current.enableOnContentEditable
    },
    [hotkey, isExternallyEnabled]
  )
}

export const useShortcutDisplay = (shortcutKey: ShortcutKey | ShortcutPreferenceKey): string => {
  const fullKey = toFullKey(shortcutKey)
  const definition = findShortcutDefinition(fullKey)
  const [preference] = usePreference(fullKey)
  const resolved = definition ? resolveShortcutPreference(definition, preference) : null

  return useMemo(() => {
    if (!definition || !resolved || !resolved.enabled || !resolved.binding.length) {
      return ''
    }

    return formatShortcutDisplay(resolved.binding, isMac)
  }, [definition, resolved])
}

export interface ShortcutListItem {
  key: ShortcutPreferenceKey
  label: string
  definition: (typeof SHORTCUT_DEFINITIONS)[number]
  preference: ResolvedShortcut
  defaultPreference: ResolvedShortcut
}

export const getAllShortcutDefaultPreferences = (): Record<ShortcutPreferenceKey, PreferenceShortcutType> => {
  return SHORTCUT_DEFINITIONS.reduce(
    (acc, definition) => {
      const defaultPreference = getDefaultShortcut(definition)
      acc[definition.key] = {
        binding: defaultPreference.binding,
        enabled: defaultPreference.enabled
      }
      return acc
    },
    {} as Record<ShortcutPreferenceKey, PreferenceShortcutType>
  )
}

export const useAllShortcuts = () => {
  const [values, setValues] = useMultiplePreferences(shortcutPreferenceKeyMap)
  const [dependencyValues] = useMultiplePreferences(shortcutDependencyPreferenceKeyMap)

  const updatePreference = useCallback(
    async (key: ShortcutPreferenceKey, patch: Partial<PreferenceShortcutType>) => {
      const definition = findShortcutDefinition(key)
      if (!definition) return
      const currentValue = values[definition.key] as PreferenceShortcutType | undefined
      const state = resolveShortcutPreference(definition, currentValue)
      const nextValue = buildNextPreference(state, currentValue, patch)
      await setValues({ [definition.key]: nextValue } as Partial<Record<string, PreferenceShortcutType>>)
    },
    [setValues, values]
  )

  const shortcuts = useMemo(
    () =>
      SHORTCUT_DEFINITIONS.flatMap((definition) => {
        const supported = definition.supportedPlatforms
        if (supported && platform && !supported.includes(platform as SupportedPlatform)) {
          return []
        }
        if (!isShortcutDefinitionEnabled(definition, (key) => dependencyValues[key])) {
          return []
        }

        const rawValue = values[definition.key] as PreferenceShortcutType | undefined
        const preference = resolveShortcutPreference(definition, rawValue)

        return [
          {
            key: definition.key,
            label: getShortcutLabel(definition.labelKey),
            definition,
            preference: {
              binding: preference.binding,
              enabled: preference.enabled && preference.binding.length > 0
            },
            defaultPreference: getDefaultShortcut(definition)
          }
        ]
      }),
    [dependencyValues, values]
  )

  return { shortcuts, updatePreference }
}
