export const SHORTCUT_MODIFIERS = ['CommandOrControl', 'Command', 'Ctrl', 'Alt', 'AltGr', 'Shift', 'Meta'] as const

export const SHORTCUT_LETTERS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z'
] as const

export const SHORTCUT_DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export const SHORTCUT_FUNCTION_KEYS = [
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12'
] as const

export const SHORTCUT_SYMBOLS = ['=', '-', '[', ']', ',', '.', '/', '\\', ';', "'", '`'] as const

export const SHORTCUT_NAMED_KEYS = [
  'Escape',
  'Enter',
  'Tab',
  'Space',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Up',
  'Down',
  'Left',
  'Right',
  'numadd',
  'numsub'
] as const

export type ShortcutModifier = (typeof SHORTCUT_MODIFIERS)[number]
export type ShortcutLetter = (typeof SHORTCUT_LETTERS)[number]
export type ShortcutDigit = (typeof SHORTCUT_DIGITS)[number]
export type ShortcutFunctionKey = (typeof SHORTCUT_FUNCTION_KEYS)[number]
export type ShortcutSymbol = (typeof SHORTCUT_SYMBOLS)[number]
export type ShortcutNamedKey = (typeof SHORTCUT_NAMED_KEYS)[number]

export type ShortcutToken =
  | ShortcutModifier
  | ShortcutLetter
  | ShortcutDigit
  | ShortcutFunctionKey
  | ShortcutSymbol
  | ShortcutNamedKey

export type ShortcutBinding = readonly ShortcutToken[]

const shortcutTokens = [
  ...SHORTCUT_MODIFIERS,
  ...SHORTCUT_LETTERS,
  ...SHORTCUT_DIGITS,
  ...SHORTCUT_FUNCTION_KEYS,
  ...SHORTCUT_SYMBOLS,
  ...SHORTCUT_NAMED_KEYS
] as const

const shortcutTokenSet = new Set<string>(shortcutTokens)
const shortcutModifierSet = new Set<string>(SHORTCUT_MODIFIERS)
const shortcutFunctionKeySet = new Set<string>(SHORTCUT_FUNCTION_KEYS)
const shortcutTokenLowerCaseMap = new Map<string, ShortcutToken>(
  shortcutTokens.map((token) => [token.toLowerCase(), token])
)

const keyAliases: Record<string, ShortcutToken> = {
  Cmd: 'Command',
  cmd: 'Command',
  Command: 'Command',
  command: 'Command',
  Control: 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  Option: 'Alt',
  option: 'Alt',
  AltGraph: 'AltGr',
  altgraph: 'AltGr',
  Esc: 'Escape',
  esc: 'Escape',
  Spacebar: 'Space',
  spacebar: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Add: 'numadd',
  NumpadAdd: 'numadd',
  Subtract: 'numsub',
  NumpadSubtract: 'numsub',
  Slash: '/',
  Semicolon: ';',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Minus: '-',
  Equal: '=',
  Backquote: '`'
}

const domCodeToToken: Record<string, ShortcutToken> = {
  NumpadEnter: 'Enter',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub'
}

export const isShortcutToken = (value: unknown): value is ShortcutToken =>
  typeof value === 'string' && shortcutTokenSet.has(value)

export const isShortcutModifier = (value: unknown): value is ShortcutModifier =>
  typeof value === 'string' && shortcutModifierSet.has(value)

export const isShortcutFunctionKey = (value: unknown): value is ShortcutFunctionKey =>
  typeof value === 'string' && shortcutFunctionKeySet.has(value)

export const normalizeShortcutToken = (value: string): ShortcutToken | undefined => {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  if (isShortcutToken(trimmed)) {
    return trimmed
  }

  if (keyAliases[trimmed]) {
    return keyAliases[trimmed]
  }

  const canonicalToken = shortcutTokenLowerCaseMap.get(trimmed.toLowerCase())
  if (canonicalToken) {
    return canonicalToken
  }

  if (domCodeToToken[trimmed]) {
    return domCodeToToken[trimmed]
  }

  const letterMatch = trimmed.match(/^Key([A-Z])$/)
  if (letterMatch) {
    return letterMatch[1] as ShortcutLetter
  }

  const digitMatch = trimmed.match(/^(?:Digit|Numpad)(\d)$/)
  if (digitMatch) {
    return digitMatch[1] as ShortcutDigit
  }

  const upper = trimmed.toUpperCase()
  if (/^[A-Z]$/.test(upper) && isShortcutToken(upper)) {
    return upper
  }

  if (/^F(?:[1-9]|1[0-2])$/.test(upper) && isShortcutToken(upper)) {
    return upper as ShortcutFunctionKey
  }

  const lower = trimmed.toLowerCase()
  if (lower === 'commandorcontrol') return 'CommandOrControl'
  if (lower === 'altgr') return 'AltGr'
  if (lower === 'numadd') return 'numadd'
  if (lower === 'numsub') return 'numsub'

  return undefined
}

export const normalizeShortcutBinding = (value: unknown): ShortcutBinding => {
  if (!Array.isArray(value)) {
    return []
  }

  const tokens: ShortcutToken[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      return []
    }

    const token = normalizeShortcutToken(item)
    if (!token) {
      return []
    }

    tokens.push(token)
  }

  return tokens
}

export const isShortcutBinding = (value: unknown): value is ShortcutBinding => {
  if (!Array.isArray(value)) {
    return false
  }
  return value.every(isShortcutToken)
}

// ---------------------------------------------------------------------------
// Display / accelerator formatting (token-typed) for the unified command system.
// ---------------------------------------------------------------------------

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

export const ZOOM_SHORTCUTS = [
  {
    key: 'zoom_in',
    shortcut: ['CommandOrControl', '='],
    editable: false,
    enabled: true,
    system: true
  },
  {
    key: 'zoom_out',
    shortcut: ['CommandOrControl', '-'],
    editable: false,
    enabled: true,
    system: true
  },
  {
    key: 'zoom_reset',
    shortcut: ['CommandOrControl', '0'],
    editable: false,
    enabled: true,
    system: true
  }
]
