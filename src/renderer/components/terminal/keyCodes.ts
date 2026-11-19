import { GHOSTTY_KEY_CODES } from '@shared/types/terminal'
// Adapted from T3 Code, copyright (c) 2026 T3 Tools Inc. (MIT).
// Provenance and license: resources/terminal/ghostty/README.md.

const isMacPlatform = (platform: string) => /mac|iphone|ipad|ipod/i.test(platform)
const US_SHIFTED_TO_UNSHIFTED_KEYS = new Map(
  [...'~!@#$%^&*()_+{}|:"<>?'].map((key, index) => [key, "`1234567890-=[]\\;',./"[index]])
)

// This order mirrors GhosttyKey in ghostty/vt/key/event.h. The values are
// intentionally derived from the official W3C-aligned enum instead of
// maintaining a second keyboard protocol.

const codeToGhosttyKey = new Map<string, number>(GHOSTTY_KEY_CODES.map((code, index) => [code, index]))

export function ghosttyKeyForCode(code: string): number {
  return codeToGhosttyKey.get(code) ?? 0
}

export function ghosttyKeyForEvent(event: Pick<KeyboardEvent, 'code' | 'key'>): number {
  // Android browsers can omit the physical code for keys such as Backspace.
  return ghosttyKeyForCode(event.code) || ghosttyKeyForCode(event.key)
}

export interface GhosttyKeyboardLayoutMap {
  get(code: string): string | undefined
}

let keyboardLayoutMapPromise: Promise<GhosttyKeyboardLayoutMap | undefined> | undefined

export function loadGhosttyKeyboardLayoutMap(): Promise<GhosttyKeyboardLayoutMap | undefined> {
  if (keyboardLayoutMapPromise) return keyboardLayoutMapPromise
  const browserNavigator = globalThis.navigator as
    | (Navigator & {
        readonly keyboard?: {
          getLayoutMap(): Promise<GhosttyKeyboardLayoutMap>
        }
      })
    | undefined
  const keyboard = browserNavigator?.keyboard
  const promise = keyboard?.getLayoutMap().catch(() => undefined) ?? Promise.resolve(undefined)
  keyboardLayoutMapPromise = promise
  return promise
}

// Browsers omit consumed modifiers; macOS Option composes layout characters too.
export function ghosttyConsumedMods(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
  platform = navigator.platform
): number {
  if (event.ctrlKey || event.metaKey || [...event.key].length !== 1) return 0
  if (event.altKey && !isMacPlatform(platform)) return 0
  return (event.shiftKey ? 1 : 0) | (event.altKey ? 1 << 2 : 0)
}

export function ghosttyUnshiftedCodepoint(
  event: Pick<KeyboardEvent, 'code' | 'key' | 'shiftKey'>,
  layoutMap?: GhosttyKeyboardLayoutMap
): number {
  if ([...event.key].length !== 1) return 0
  const layoutCharacter = layoutMap?.get(event.code)
  if (layoutCharacter && [...layoutCharacter].length === 1) {
    return layoutCharacter.codePointAt(0) ?? 0
  }
  if (/^[A-Z]$/u.test(event.key)) return event.key.charCodeAt(0) + 32
  if (event.shiftKey) {
    const unshiftedCharacter = US_SHIFTED_TO_UNSHIFTED_KEYS.get(event.key)
    if (unshiftedCharacter) return unshiftedCharacter.codePointAt(0) ?? 0
    const lowercase = event.key.toLowerCase()
    if (lowercase !== event.key && [...lowercase].length === 1) {
      return lowercase.codePointAt(0) ?? 0
    }
    // Without layout data, the unshifted character is unknown; guessing corrupts Kitty alternate keys.
    return 0
  }
  return event.key.codePointAt(0) ?? 0
}
