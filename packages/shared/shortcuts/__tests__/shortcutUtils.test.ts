import { describe, expect, it } from 'vitest'

import { findShortcutDefinition, SHORTCUT_DEFINITIONS } from '../definitions'
import type { ShortcutDefinition } from '../types'
import {
  convertAcceleratorToHotkey,
  convertKeyToAccelerator,
  formatShortcutDisplay,
  getDefaultShortcut,
  isShortcutDefinitionEnabled,
  isValidShortcut,
  resolveShortcutPreference
} from '../utils'

const makeDefinition = (overrides: Partial<ShortcutDefinition> = {}): ShortcutDefinition => ({
  key: 'shortcut.chat.clear',
  scope: 'renderer',
  category: 'chat',
  labelKey: 'clear_topic',
  ...overrides
})

describe('convertKeyToAccelerator', () => {
  it('maps known keys to accelerator format', () => {
    expect(convertKeyToAccelerator('Command')).toBe('CommandOrControl')
    expect(convertKeyToAccelerator('Cmd')).toBe('CommandOrControl')
    expect(convertKeyToAccelerator('Control')).toBe('Ctrl')
    expect(convertKeyToAccelerator('ArrowUp')).toBe('Up')
    expect(convertKeyToAccelerator('ArrowDown')).toBe('Down')
    expect(convertKeyToAccelerator('Slash')).toBe('/')
    expect(convertKeyToAccelerator('BracketLeft')).toBe('[')
  })

  it('returns the key unchanged if not in the map', () => {
    expect(convertKeyToAccelerator('A')).toBe('A')
    expect(convertKeyToAccelerator('Shift')).toBe('Shift')
  })
})

describe('convertAcceleratorToHotkey', () => {
  it('converts modifier keys to hotkey format', () => {
    expect(convertAcceleratorToHotkey(['CommandOrControl', 'L'])).toBe('mod+l')
    expect(convertAcceleratorToHotkey(['Ctrl', 'Shift', 'F'])).toBe('ctrl+shift+f')
    expect(convertAcceleratorToHotkey(['Alt', 'N'])).toBe('alt+n')
    expect(convertAcceleratorToHotkey(['Command', 'K'])).toBe('meta+k')
    expect(convertAcceleratorToHotkey(['Meta', 'E'])).toBe('meta+e')
  })

  it('handles single keys', () => {
    expect(convertAcceleratorToHotkey(['Escape'])).toBe('escape')
  })
})

describe('formatShortcutDisplay', () => {
  it('formats for Mac with symbols', () => {
    expect(formatShortcutDisplay(['CommandOrControl', 'L'], true)).toBe('⌘L')
    expect(formatShortcutDisplay(['Ctrl', 'Shift', 'F'], true)).toBe('⌃⇧F')
    expect(formatShortcutDisplay(['Alt', 'N'], true)).toBe('⌥N')
    expect(formatShortcutDisplay(['Meta', 'E'], true)).toBe('⌘E')
  })

  it('formats for non-Mac with text', () => {
    expect(formatShortcutDisplay(['CommandOrControl', 'L'], false)).toBe('Ctrl+L')
    expect(formatShortcutDisplay(['Ctrl', 'Shift', 'F'], false)).toBe('Ctrl+Shift+F')
    expect(formatShortcutDisplay(['Alt', 'N'], false)).toBe('Alt+N')
    expect(formatShortcutDisplay(['Meta', 'E'], false)).toBe('Win+E')
  })

  it('capitalizes non-modifier keys', () => {
    expect(formatShortcutDisplay(['Escape'], true)).toBe('Escape')
    expect(formatShortcutDisplay(['f1'], false)).toBe('F1')
  })
})

describe('isValidShortcut', () => {
  it('returns false for empty array', () => {
    expect(isValidShortcut([])).toBe(false)
  })

  it('returns true for modifier + non-modifier key', () => {
    expect(isValidShortcut(['CommandOrControl', 'A'])).toBe(true)
    expect(isValidShortcut(['Ctrl', 'Shift', 'N'])).toBe(true)
    expect(isValidShortcut(['Alt', 'X'])).toBe(true)
  })

  it('returns false for modifier-only combinations', () => {
    expect(isValidShortcut(['CommandOrControl'])).toBe(false)
    expect(isValidShortcut(['Ctrl', 'Shift'])).toBe(false)
    expect(isValidShortcut(['Alt', 'Meta'])).toBe(false)
  })

  it('returns true for special single keys', () => {
    expect(isValidShortcut(['Escape'])).toBe(true)
    expect(isValidShortcut(['F1'])).toBe(true)
    expect(isValidShortcut(['F12'])).toBe(true)
  })

  it('returns false for non-modifier non-special single key', () => {
    expect(isValidShortcut(['A'])).toBe(false)
    expect(isValidShortcut(['L'])).toBe(false)
  })
})

describe('getDefaultShortcut', () => {
  it('returns default preference from schema defaults', () => {
    const def = makeDefinition()
    const result = getDefaultShortcut(def)

    expect(result.binding).toEqual(['CommandOrControl', 'L'])
    expect(result.enabled).toBe(true)
  })
})

describe('resolveShortcutPreference', () => {
  it('returns fallback when value is undefined', () => {
    const def = makeDefinition()
    const result = resolveShortcutPreference(def, undefined)

    expect(result.binding).toEqual(['CommandOrControl', 'L'])
    expect(result.enabled).toBe(true)
  })

  it('returns fallback when value is null', () => {
    const def = makeDefinition()
    const result = resolveShortcutPreference(def, null)

    expect(result.binding).toEqual(['CommandOrControl', 'L'])
  })

  it('uses custom binding when provided', () => {
    const def = makeDefinition()
    const result = resolveShortcutPreference(def, {
      binding: ['Alt', 'L'],
      enabled: true
    })

    expect(result.binding).toEqual(['Alt', 'L'])
  })

  it('returns empty binding when binding is explicitly cleared (empty array)', () => {
    const def = makeDefinition()
    const result = resolveShortcutPreference(def, {
      binding: [],
      enabled: true
    })

    expect(result.binding).toEqual([])
  })

  it('respects enabled: false from preference', () => {
    const def = makeDefinition()
    const result = resolveShortcutPreference(def, {
      binding: ['CommandOrControl', 'L'],
      enabled: false
    })

    expect(result.enabled).toBe(false)
  })
})

describe('isShortcutDefinitionEnabled', () => {
  it('returns true when no dependency is declared', () => {
    expect(isShortcutDefinitionEnabled(makeDefinition(), () => false)).toBe(true)
  })

  it('returns true when the required preference is enabled', () => {
    const def = makeDefinition({ enabledWhen: 'feature.quick_assistant.enabled' })
    expect(isShortcutDefinitionEnabled(def, () => true)).toBe(true)
  })

  it('returns false when the required preference is disabled', () => {
    const def = makeDefinition({ enabledWhen: 'feature.quick_assistant.enabled' })
    expect(isShortcutDefinitionEnabled(def, () => false)).toBe(false)
  })
})

describe('SHORTCUT_DEFINITIONS', () => {
  it('has unique preference keys', () => {
    const keys = SHORTCUT_DEFINITIONS.map((d) => d.key)
    const unique = new Set(keys)
    expect(unique.size).toBe(keys.length)
  })

  it('has non-empty labelKey for every entry', () => {
    for (const def of SHORTCUT_DEFINITIONS) {
      expect(def.labelKey, `missing labelKey for ${def.key}`).toBeTruthy()
    }
  })

  it('uses `shortcut.` prefix for every preference key', () => {
    for (const def of SHORTCUT_DEFINITIONS) {
      expect(def.key.startsWith('shortcut.')).toBe(true)
    }
  })

  it('has schema defaults for every definition', () => {
    for (const def of SHORTCUT_DEFINITIONS) {
      const resolved = getDefaultShortcut(def)
      expect(Array.isArray(resolved.binding), `missing default binding for ${def.key}`).toBe(true)
      expect(typeof resolved.enabled, `missing default enabled flag for ${def.key}`).toBe('boolean')
    }
  })

  it('is resolvable via findShortcutDefinition', () => {
    for (const def of SHORTCUT_DEFINITIONS) {
      expect(findShortcutDefinition(def.key)).toBe(def)
    }
  })

  it('returns undefined for unknown keys', () => {
    expect(findShortcutDefinition('shortcut.unknown.nope' as never)).toBeUndefined()
  })
})
