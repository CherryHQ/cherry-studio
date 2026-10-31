import type { SupportedPlatform } from '@shared/types/command'
import { resolveCommandByKeybinding, type ResolveCommandByKeybindingOptions } from '@shared/utils/command'
import {
  formatKeyDisplay,
  getShortcutBindingFromKeyboardEvent,
  isShortcutModifier,
  normalizeShortcutToken,
  type ShortcutBinding,
  type ShortcutToken
} from '@shared/utils/shortcut'

const MODIFIER_CODES: Record<string, ShortcutToken> = {
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  MetaLeft: 'Meta',
  MetaRight: 'Meta'
}

export function isDictationShortcutModifier(code: string): boolean {
  return Object.hasOwn(MODIFIER_CODES, code)
}

export function parseDictationShortcut(value: string): string[] {
  if (!value) return []
  const codes = value.split('+')
  const modifiers = codes.filter(isDictationShortcutModifier)
  if (codes.length > 3 || modifiers.length === 0 || codes.length - modifiers.length > 1) return []
  if (new Set(modifiers.map((code) => MODIFIER_CODES[code])).size !== modifiers.length) return []
  if (new Set(codes).size !== codes.length) return []
  if (
    codes.some((code) => {
      if (isDictationShortcutModifier(code)) return false
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
      const token = MODIFIER_CODES[code] ?? normalizeShortcutToken(code)!
      const label = formatKeyDisplay(token, isMac)
      return MODIFIER_CODES[code] ? `${code.endsWith('Left') ? left : right} ${label}` : label
    })
    .join(' + ')
}

export function getDictationShortcutBinding(value: string, platform: SupportedPlatform): ShortcutBinding {
  const codes = parseDictationShortcut(value)
  const code = codes.find((code) => !MODIFIER_CODES[code]) ?? codes[0] ?? ''
  return getShortcutBindingFromKeyboardEvent(
    {
      key: MODIFIER_CODES[code] ?? code,
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

export function dictationShortcutsConflict(hold: string, toggle: string): boolean {
  const holdCodes = parseDictationShortcut(hold)
  const toggleCodes = parseDictationShortcut(toggle)
  return toggleCodes.length > 0 && toggleCodes.every((code) => holdCodes.includes(code))
}

export function hasDictationCommandConflict(
  value: string,
  options: Pick<ResolveCommandByKeybindingOptions, 'preferences' | 'context'> & { platform: SupportedPlatform }
): boolean {
  return getDictationShortcutBinding(value, options.platform)
    .reduce<ShortcutBinding[]>((bindings, key) => [...bindings, ...bindings.map((binding) => [...binding, key])], [[]])
    .some((binding) => resolveCommandByKeybinding({ ...options, binding }))
}
