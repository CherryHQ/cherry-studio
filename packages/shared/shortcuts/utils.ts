import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'

import type { ShortcutDefinition, ShortcutPreferenceValue } from './types'

const modifierKeys = ['CommandOrControl', 'Ctrl', 'Alt', 'Shift', 'Meta', 'Command']
const specialSingleKeys = ['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']

export const convertKeyToAccelerator = (key: string): string => {
  const keyMap: Record<string, string> = {
    Command: 'CommandOrControl',
    Cmd: 'CommandOrControl',
    Control: 'Ctrl',
    Meta: 'Meta',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    AltGraph: 'AltGr',
    Slash: '/',
    Semicolon: ';',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Quote: "'",
    Comma: ',',
    Minus: '-',
    Equal: '='
  }

  return keyMap[key] || key
}

export const convertAcceleratorToHotkey = (accelerator: string[]): string => {
  return accelerator
    .map((key) => {
      switch (key.toLowerCase()) {
        case 'commandorcontrol':
          return 'mod'
        case 'command':
        case 'cmd':
          return 'meta'
        case 'control':
        case 'ctrl':
          return 'ctrl'
        case 'alt':
          return 'alt'
        case 'shift':
          return 'shift'
        case 'meta':
          return 'meta'
        default:
          return key.toLowerCase()
      }
    })
    .join('+')
}

export const formatShortcutDisplay = (keys: string[], isMac: boolean): string => {
  return keys
    .map((key) => {
      switch (key.toLowerCase()) {
        case 'ctrl':
        case 'control':
          return isMac ? '⌃' : 'Ctrl'
        case 'command':
        case 'cmd':
          return isMac ? '⌘' : 'Win'
        case 'commandorcontrol':
          return isMac ? '⌘' : 'Ctrl'
        case 'alt':
          return isMac ? '⌥' : 'Alt'
        case 'shift':
          return isMac ? '⇧' : 'Shift'
        case 'meta':
          return isMac ? '⌘' : 'Win'
        default:
          return key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()
      }
    })
    .join(isMac ? '' : '+')
}

export const isValidShortcut = (keys: string[]): boolean => {
  if (!keys.length) {
    return false
  }

  const hasModifier = keys.some((key) => modifierKeys.includes(key))
  const isSpecialKey = keys.length === 1 && specialSingleKeys.includes(keys[0])

  return hasModifier || isSpecialKey
}

const ensureArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  return []
}

const ensureBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

export const getDefaultShortcutPreference = (definition: ShortcutDefinition): ShortcutPreferenceValue => {
  const fallback = DefaultPreferences.default[definition.key] as PreferenceShortcutType

  const rawBinding = ensureArray(fallback?.key)
  const binding = rawBinding.length ? rawBinding : definition.defaultKey

  return {
    binding,
    rawBinding: binding,
    hasCustomBinding: false,
    enabled: ensureBoolean(fallback?.enabled, true),
    editable: ensureBoolean(fallback?.editable, true),
    system: ensureBoolean(fallback?.system, false)
  }
}

export const coerceShortcutPreference = (
  definition: ShortcutDefinition,
  value?: PreferenceShortcutType | null
): ShortcutPreferenceValue => {
  const fallback = getDefaultShortcutPreference(definition)
  const hasCustomBinding = Array.isArray((value as PreferenceShortcutType | undefined)?.key)
  const rawBinding = hasCustomBinding ? ensureArray((value as PreferenceShortcutType).key) : fallback.binding
  const binding = rawBinding.length > 0 ? rawBinding : fallback.binding

  return {
    binding,
    rawBinding,
    hasCustomBinding,
    enabled: ensureBoolean(value?.enabled, fallback.enabled),
    editable: ensureBoolean(value?.editable, fallback.editable),
    system: ensureBoolean(value?.system, fallback.system)
  }
}
