import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { isMac } from '@renderer/config/constant'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { findShortcutDefinition, SHORTCUT_DEFINITIONS } from '@shared/shortcuts/definitions'
import type { ShortcutDefinition, ShortcutPreferenceKey, ShortcutPreferenceValue } from '@shared/shortcuts/types'
import {
  coerceShortcutPreference,
  convertAcceleratorToHotkey,
  formatShortcutDisplay,
  getDefaultShortcutPreference
} from '@shared/shortcuts/utils'
import { useCallback, useMemo } from 'react'
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

const resolvePreferenceValue = (
  definition: ShortcutDefinition | undefined,
  preference: PreferenceShortcutType | Record<string, unknown> | undefined
): ShortcutPreferenceValue | null => {
  if (!definition) {
    return null
  }
  return coerceShortcutPreference(definition, preference as PreferenceShortcutType | undefined)
}

export const useShortcut = (
  shortcutKey: ShortcutPreferenceKey,
  callback: (event: KeyboardEvent) => void,
  options: UseShortcutOptions = defaultOptions
) => {
  const definition = useMemo(() => findShortcutDefinition(shortcutKey), [shortcutKey])
  const [preference] = usePreference(shortcutKey)
  const preferenceState = useMemo(() => resolvePreferenceValue(definition, preference), [definition, preference])

  const hotkey = useMemo(() => {
    if (!definition || !preferenceState) {
      return 'none'
    }

    if (definition.scope === 'main') {
      return 'none'
    }

    if (!preferenceState.enabled) {
      return 'none'
    }

    const effectiveBinding = preferenceState.binding.length > 0 ? preferenceState.binding : definition.defaultKey

    if (!effectiveBinding.length) {
      return 'none'
    }

    return convertAcceleratorToHotkey(effectiveBinding)
  }, [definition, preferenceState])

  useHotkeys(
    hotkey,
    (event) => {
      if (options.preventDefault) {
        event.preventDefault()
      }
      if (options.enabled !== false) {
        callback(event)
      }
    },
    {
      enableOnFormTags: options.enableOnFormTags,
      description: options.description ?? shortcutKey,
      enabled: hotkey !== 'none',
      enableOnContentEditable: options.enableOnContentEditable
    },
    [hotkey, callback, options]
  )
}

export const useShortcutDisplay = (shortcutKey: ShortcutPreferenceKey): string => {
  const definition = useMemo(() => findShortcutDefinition(shortcutKey), [shortcutKey])
  const [preference] = usePreference(shortcutKey)
  const preferenceState = useMemo(() => resolvePreferenceValue(definition, preference), [definition, preference])

  if (!definition || !preferenceState || !preferenceState.enabled) {
    return ''
  }

  const displayBinding = preferenceState.binding.length > 0 ? preferenceState.binding : definition.defaultKey

  if (!displayBinding.length) {
    return ''
  }

  return formatShortcutDisplay(displayBinding, isMac)
}

export interface ShortcutListItem {
  definition: ShortcutDefinition
  preference: ShortcutPreferenceValue
  defaultPreference: ShortcutPreferenceValue
  updatePreference: (patch: Partial<PreferenceShortcutType>) => Promise<void>
}

export const useAllShortcuts = (): ShortcutListItem[] => {
  const keyMap = useMemo(
    () =>
      SHORTCUT_DEFINITIONS.reduce<Record<string, ShortcutPreferenceKey>>((acc, definition) => {
        acc[definition.key] = definition.key
        return acc
      }, {}),
    []
  )

  const [values, setValues] = useMultiplePreferences(keyMap)

  const buildNextPreference = useCallback(
    (
      state: ShortcutPreferenceValue,
      currentValue: PreferenceShortcutType | undefined,
      patch: Partial<PreferenceShortcutType>
    ): PreferenceShortcutType => {
      const current = (currentValue ?? {}) as PreferenceShortcutType

      const nextKey = Array.isArray(patch.key) ? patch.key : Array.isArray(current.key) ? current.key : state.rawBinding

      const nextEnabled =
        typeof patch.enabled === 'boolean'
          ? patch.enabled
          : typeof current.enabled === 'boolean'
            ? current.enabled
            : state.enabled

      const nextEditable =
        typeof patch.editable === 'boolean'
          ? patch.editable
          : typeof current.editable === 'boolean'
            ? current.editable
            : state.editable

      const nextSystem =
        typeof patch.system === 'boolean'
          ? patch.system
          : typeof current.system === 'boolean'
            ? current.system
            : state.system

      return {
        key: nextKey,
        enabled: nextEnabled,
        editable: nextEditable,
        system: nextSystem
      }
    },
    []
  )

  return useMemo(
    () =>
      SHORTCUT_DEFINITIONS.map((definition) => {
        const rawValue = values[definition.key] as PreferenceShortcutType | undefined
        const preference = coerceShortcutPreference(definition, rawValue)
        const defaultPreference = getDefaultShortcutPreference(definition)

        const updatePreference = async (patch: Partial<PreferenceShortcutType>) => {
          const currentValue = values[definition.key] as PreferenceShortcutType | undefined
          const nextValue = buildNextPreference(preference, currentValue, patch)
          await setValues({ [definition.key]: nextValue } as Partial<Record<string, PreferenceShortcutType>>)
        }

        return {
          definition,
          preference,
          defaultPreference,
          updatePreference
        }
      }),
    [buildNextPreference, setValues, values]
  )
}
