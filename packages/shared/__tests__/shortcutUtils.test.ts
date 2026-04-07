import { describe, expect, it } from 'vitest'

import type { ShortcutDefinition } from '../shortcuts/types'
import {
  coerceShortcutPreference,
  convertAcceleratorToHotkey,
  convertKeyToAccelerator,
  formatShortcutDisplay,
  getDefaultShortcutPreference,
  isValidShortcut
} from '../shortcuts/utils'

const makeDefinition = (overrides: Partial<ShortcutDefinition> = {}): ShortcutDefinition => ({
  key: 'shortcut.chat.clear',
  defaultKey: ['CommandOrControl', 'L'],
  scope: 'renderer',
  category: 'chat',
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

describe('getDefaultShortcutPreference', () => {
  it('returns default preference from schema defaults', () => {
    const def = makeDefinition()
    const result = getDefaultShortcutPreference(def)

    expect(result.binding).toEqual(['CommandOrControl', 'L'])
    expect(result.hasCustomBinding).toBe(false)
    expect(result.enabled).toBe(true)
    expect(result.editable).toBe(true)
    expect(result.system).toBe(false)
  })

  it('respects editable: false', () => {
    const def = makeDefinition({ editable: false })
    expect(getDefaultShortcutPreference(def).editable).toBe(false)
  })

  it('respects system: true', () => {
    const def = makeDefinition({ system: true })
    expect(getDefaultShortcutPreference(def).system).toBe(true)
  })
})

describe('coerceShortcutPreference', () => {
  it('returns fallback when value is undefined', () => {
    const def = makeDefinition()
    const result = coerceShortcutPreference(def, undefined)

    expect(result.binding).toEqual(['CommandOrControl', 'L'])
    expect(result.hasCustomBinding).toBe(false)
    expect(result.enabled).toBe(true)
  })

  it('returns fallback when value is null', () => {
    const def = makeDefinition()
    const result = coerceShortcutPreference(def, null)

    expect(result.binding).toEqual(['CommandOrControl', 'L'])
    expect(result.hasCustomBinding).toBe(false)
  })

  it('uses custom key when provided', () => {
    const def = makeDefinition()
    const result = coerceShortcutPreference(def, {
      key: ['Alt', 'L'],
      enabled: true
    })

    expect(result.binding).toEqual(['Alt', 'L'])
    expect(result.rawBinding).toEqual(['Alt', 'L'])
    expect(result.hasCustomBinding).toBe(true)
  })

  it('respects user-cleared binding (empty array)', () => {
    const def = makeDefinition()
    const result = coerceShortcutPreference(def, {
      key: [],
      enabled: true
    })

    expect(result.binding).toEqual([])
    expect(result.rawBinding).toEqual([])
    expect(result.hasCustomBinding).toBe(true)
  })

  it('respects enabled: false from preference', () => {
    const def = makeDefinition()
    const result = coerceShortcutPreference(def, {
      key: ['CommandOrControl', 'L'],
      enabled: false
    })

    expect(result.enabled).toBe(false)
  })
})
