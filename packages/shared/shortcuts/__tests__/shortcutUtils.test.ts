import { describe, expect, it } from 'vitest'

import { isShortcutBinding, normalizeShortcutBinding, normalizeShortcutToken } from '../tokens'
import { convertAcceleratorToHotkey, convertKeyToAccelerator, formatShortcutDisplay, isValidShortcut } from '../utils'

describe('shortcut tokens', () => {
  it('normalizes letters, digits, function keys, and DOM key codes', () => {
    expect(normalizeShortcutToken('a')).toBe('A')
    expect(normalizeShortcutToken('KeyZ')).toBe('Z')
    expect(normalizeShortcutToken('Digit7')).toBe('7')
    expect(normalizeShortcutToken('Numpad7')).toBe('7')
    expect(normalizeShortcutToken('f12')).toBe('F12')
    expect(normalizeShortcutToken('ArrowLeft')).toBe('Left')
    expect(normalizeShortcutToken('NumpadAdd')).toBe('numadd')
  })

  it('rejects unknown tokens instead of preserving arbitrary strings', () => {
    expect(normalizeShortcutToken('Nope')).toBeUndefined()
    expect(normalizeShortcutBinding(['CommandOrControl', 'Nope'])).toEqual([])
    expect(isShortcutBinding(['CommandOrControl', 'Nope'])).toBe(false)
    expect(isShortcutBinding(['CommandOrControl', 'N'])).toBe(true)
  })
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

  it('normalizes valid keys that do not need mapping', () => {
    expect(convertKeyToAccelerator('A')).toBe('A')
    expect(convertKeyToAccelerator('Shift')).toBe('Shift')
  })

  it('rejects unknown keys', () => {
    expect(convertKeyToAccelerator('UnknownKey')).toBeUndefined()
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
    expect(formatShortcutDisplay(normalizeShortcutBinding(['f1']), false)).toBe('F1')
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
