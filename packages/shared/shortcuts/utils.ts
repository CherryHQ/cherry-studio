import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'

import type { ResolvedShortcut, ShortcutDefinition } from './types'

const modifierKeys = ['CommandOrControl', 'Ctrl', 'Alt', 'Shift', 'Meta', 'Command']
const specialSingleKeys = ['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']

const acceleratorKeyMap: Record<string, string> = {
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

export const convertKeyToAccelerator = (key: string): string => acceleratorKeyMap[key] || key

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

export const formatKeyDisplay = (key: string, isMac: boolean): string => {
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
}

export const formatShortcutDisplay = (keys: string[], isMac: boolean): string => {
  return keys.map((key) => formatKeyDisplay(key, isMac)).join(isMac ? '' : '+')
}

export const isValidShortcut = (keys: string[]): boolean => {
  if (!keys.length) {
    return false
  }

  if (new Set(keys).size !== keys.length) {
    return false
  }

  const hasModifier = keys.some((key) => modifierKeys.includes(key))
  const hasNonModifier = keys.some((key) => !modifierKeys.includes(key))
  const isSpecialKey = keys.length === 1 && specialSingleKeys.includes(keys[0])

  return (hasModifier && hasNonModifier) || isSpecialKey
}

const ensureArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  return []
}

const ensureBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

export const getDefaultShortcut = (definition: ShortcutDefinition): ResolvedShortcut => {
  const fallback = DefaultPreferences.default[definition.key]

  return {
    binding: ensureArray(fallback?.binding),
    enabled: ensureBoolean(fallback?.enabled, true)
  }
}

export const resolveShortcutPreference = (
  definition: ShortcutDefinition,
  value?: PreferenceShortcutType | null
): ResolvedShortcut => {
  const fallback = getDefaultShortcut(definition)
  const binding = value != null ? (value.binding?.length ? ensureArray(value.binding) : []) : fallback.binding

  return {
    binding,
    enabled: ensureBoolean(value?.enabled, fallback.enabled)
  }
}

export const isShortcutDefinitionEnabled = (
  definition: ShortcutDefinition,
  getPreferenceValue: (key: NonNullable<ShortcutDefinition['enabledWhen']>) => unknown
): boolean => {
  if (!definition.enabledWhen) {
    return true
  }

  return getPreferenceValue(definition.enabledWhen) === true
}
