import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { isMac } from '@renderer/config/constant'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { findShortcutDefinition, SHORTCUT_DEFINITIONS } from '@shared/shortcuts/definitions'
import type {
  ShortcutDefinition,
  ShortcutKey,
  ShortcutPreferenceKey,
  ShortcutPreferenceValue
} from '@shared/shortcuts/types'
import {
  coerceShortcutPreference,
  convertAcceleratorToHotkey,
  formatShortcutDisplay,
  getDefaultShortcutPreference
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

const toFullKey = (key: ShortcutKey | ShortcutPreferenceKey): ShortcutPreferenceKey =>
  (key.startsWith('shortcut.') ? key : `shortcut.${key}`) as ShortcutPreferenceKey

const resolvePreferenceValue = (
  definition: ShortcutDefinition | undefined,
  preference: PreferenceShortcutType | undefined
): ShortcutPreferenceValue | null => {
  if (!definition) {
    return null
  }
  return coerceShortcutPreference(definition, preference)
}

export const useShortcut = (
  shortcutKey: ShortcutKey | ShortcutPreferenceKey,
  callback: (event: KeyboardEvent) => void,
  options: UseShortcutOptions = defaultOptions
) => {
  const fullKey = toFullKey(shortcutKey)
  const definition = useMemo(() => findShortcutDefinition(fullKey), [fullKey])
  const [preference] = usePreference(fullKey)
  const preferenceState = useMemo(() => resolvePreferenceValue(definition, preference), [definition, preference])

  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const optionsRef = useRef(options)
  optionsRef.current = options

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

    if (!preferenceState.binding.length) {
      return 'none'
    }

    return convertAcceleratorToHotkey(preferenceState.binding)
  }, [definition, preferenceState])

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
      enableOnFormTags: options.enableOnFormTags,
      description: options.description ?? fullKey,
      enabled: hotkey !== 'none',
      enableOnContentEditable: options.enableOnContentEditable
    },
    [hotkey]
  )
}

export const useShortcutDisplay = (shortcutKey: ShortcutKey | ShortcutPreferenceKey): string => {
  const fullKey = toFullKey(shortcutKey)
  const definition = useMemo(() => findShortcutDefinition(fullKey), [fullKey])
  const [preference] = usePreference(fullKey)
  const preferenceState = useMemo(() => resolvePreferenceValue(definition, preference), [definition, preference])

  return useMemo(() => {
    if (!definition || !preferenceState || !preferenceState.enabled) {
      return ''
    }

    const displayBinding = preferenceState.hasCustomBinding
      ? preferenceState.rawBinding
      : preferenceState.binding.length > 0
        ? preferenceState.binding
        : definition.defaultKey

    if (!displayBinding.length) {
      return ''
    }

    return formatShortcutDisplay(displayBinding, isMac)
  }, [definition, preferenceState])
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

      return {
        key: nextKey,
        enabled: nextEnabled
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
