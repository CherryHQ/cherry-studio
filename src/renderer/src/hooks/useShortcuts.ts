import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { isMac } from '@renderer/config/constant'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { findShortcutDefinition, SHORTCUT_DEFINITIONS } from '@shared/shortcuts/definitions'
import type { ResolvedShortcut, ShortcutDefinition, ShortcutKey, ShortcutPreferenceKey } from '@shared/shortcuts/types'
import {
  convertAcceleratorToHotkey,
  formatShortcutDisplay,
  getDefaultShortcut,
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

export const useShortcut = (
  shortcutKey: ShortcutKey | ShortcutPreferenceKey,
  callback: (event: KeyboardEvent) => void,
  options: UseShortcutOptions = defaultOptions
) => {
  const fullKey = toFullKey(shortcutKey)
  const definition = useMemo(() => findShortcutDefinition(fullKey), [fullKey])
  const [preference] = usePreference(fullKey)
  const resolved = useMemo(
    () => (definition ? resolveShortcutPreference(definition, preference) : null),
    [definition, preference]
  )

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
  const definition = useMemo(() => findShortcutDefinition(fullKey), [fullKey])
  const [preference] = usePreference(fullKey)
  const resolved = useMemo(
    () => (definition ? resolveShortcutPreference(definition, preference) : null),
    [definition, preference]
  )

  return useMemo(() => {
    if (!definition || !resolved || !resolved.enabled || !resolved.binding.length) {
      return ''
    }

    return formatShortcutDisplay(resolved.binding, isMac)
  }, [definition, resolved])
}

export interface ShortcutListItem {
  definition: ShortcutDefinition
  preference: ResolvedShortcut
  defaultPreference: ResolvedShortcut
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
      state: ResolvedShortcut,
      currentValue: PreferenceShortcutType | undefined,
      patch: Partial<PreferenceShortcutType>
    ): PreferenceShortcutType => {
      const current = (currentValue ?? {}) as PreferenceShortcutType

      const nextBinding = Array.isArray(patch.binding)
        ? patch.binding
        : Array.isArray(current.binding)
          ? current.binding
          : state.binding

      const nextEnabled =
        typeof patch.enabled === 'boolean'
          ? patch.enabled
          : typeof current.enabled === 'boolean'
            ? current.enabled
            : state.enabled

      return {
        binding: nextBinding,
        enabled: nextEnabled
      }
    },
    []
  )

  return useMemo(
    () =>
      SHORTCUT_DEFINITIONS.map((definition) => {
        const rawValue = values[definition.key] as PreferenceShortcutType | undefined
        const preference = resolveShortcutPreference(definition, rawValue)
        const defaultPreference = getDefaultShortcut(definition)

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
