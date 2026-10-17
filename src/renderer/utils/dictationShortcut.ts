import {
  formatKeyDisplay,
  getShortcutBindingFromKeyboardEvent,
  isShortcutModifier,
  normalizeShortcutToken,
  type ShortcutBinding,
  type ShortcutToken
} from '@shared/utils/shortcut'

const modifierCodes: Record<string, ShortcutToken> = {
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  MetaLeft: 'Meta',
  MetaRight: 'Meta'
}

export function parseDictationShortcut(value: string): string[] {
  if (!value) return []
  const codes = value.split('+')
  const modifiers = codes.filter((code) => modifierCodes[code])
  if (codes.length > 3 || modifiers.length === 0 || codes.length - modifiers.length > 1) return []
  if (new Set(codes).size !== codes.length) return []
  if (
    codes.some((code) => {
      if (modifierCodes[code]) return false
      const token = normalizeShortcutToken(code)
      return !token || isShortcutModifier(token) || token === 'Escape'
    })
  )
    return []
  return codes.sort()
}

export function formatDictationShortcut(value: string, isMac: boolean, left: string, right: string): string {
  const order = [
    'ControlLeft',
    'ControlRight',
    'MetaLeft',
    'MetaRight',
    'AltLeft',
    'AltRight',
    'ShiftLeft',
    'ShiftRight'
  ]
  return parseDictationShortcut(value)
    .sort((a, b) => (order.includes(a) ? order.indexOf(a) : 8) - (order.includes(b) ? order.indexOf(b) : 8))
    .map((code) => {
      const token = modifierCodes[code] ?? normalizeShortcutToken(code)!
      const label = formatKeyDisplay(token, isMac)
      return modifierCodes[code] ? `${code.endsWith('Left') ? left : right} ${label}` : label
    })
    .join(' + ')
}

export function getDictationShortcutBinding(value: string, platform: 'darwin' | 'win32' | 'linux'): ShortcutBinding {
  const codes = parseDictationShortcut(value)
  const code = codes.find((code) => !modifierCodes[code]) ?? codes[0] ?? ''
  return getShortcutBindingFromKeyboardEvent(
    {
      key: modifierCodes[code] ?? code,
      code,
      ctrlKey: codes.some((code) => code.startsWith('Control')),
      altKey: codes.some((code) => code.startsWith('Alt')),
      metaKey: codes.some((code) => code.startsWith('Meta')),
      shiftKey: codes.some((code) => code.startsWith('Shift'))
    },
    platform
  )
}

export function dictationShortcutMatches(value: string, pressed: ReadonlySet<string>): boolean {
  const codes = parseDictationShortcut(value)
  return codes.length > 0 && codes.length === pressed.size && codes.every((code) => pressed.has(code))
}
