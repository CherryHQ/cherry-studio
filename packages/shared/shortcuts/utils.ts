import {
  isShortcutBinding,
  isShortcutFunctionKey,
  isShortcutModifier,
  normalizeShortcutToken,
  type ShortcutBinding,
  type ShortcutToken
} from './tokens'

const acceleratorKeyMap: Record<string, ShortcutToken> = {
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

export const convertKeyToAccelerator = (key: string): ShortcutToken | undefined =>
  acceleratorKeyMap[key] ?? normalizeShortcutToken(key)

export const convertAcceleratorToHotkey = (accelerator: ShortcutBinding): string => {
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

export const formatKeyDisplay = (key: ShortcutToken, isMac: boolean): string => {
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
    case 'altgr':
      return 'AltGr'
    case 'shift':
      return isMac ? '⇧' : 'Shift'
    case 'meta':
      return isMac ? '⌘' : 'Win'
    default:
      return key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()
  }
}

export const formatShortcutDisplay = (keys: ShortcutBinding, isMac: boolean): string => {
  return keys.map((key) => formatKeyDisplay(key, isMac)).join(isMac ? '' : '+')
}

export const isValidShortcut = (binding: ShortcutBinding): boolean => {
  if (!binding.length || !isShortcutBinding(binding)) {
    return false
  }

  if (new Set(binding).size !== binding.length) {
    return false
  }

  const hasModifier = binding.some(isShortcutModifier)
  const hasNonModifier = binding.some((key) => !isShortcutModifier(key))
  const isSpecialKey = binding.length === 1 && (binding[0] === 'Escape' || isShortcutFunctionKey(binding[0]))

  return (hasModifier && hasNonModifier) || isSpecialKey
}
