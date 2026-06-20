import { describe, expect, it } from 'vitest'

import {
  convertAcceleratorToHotkey,
  isValidShortcut,
  normalizeShortcutBinding,
  normalizeShortcutToken,
  type ShortcutBinding
} from '../shortcut'

describe('normalizeShortcutToken', () => {
  it('returns canonical tokens unchanged', () => {
    expect(normalizeShortcutToken('CommandOrControl')).toBe('CommandOrControl')
    expect(normalizeShortcutToken('Shift')).toBe('Shift')
    expect(normalizeShortcutToken('A')).toBe('A')
    expect(normalizeShortcutToken('F5')).toBe('F5')
    expect(normalizeShortcutToken('/')).toBe('/')
    expect(normalizeShortcutToken('Escape')).toBe('Escape')
  })

  it('trims surrounding whitespace before matching', () => {
    expect(normalizeShortcutToken('  Shift  ')).toBe('Shift')
  })

  it('returns undefined for empty or whitespace-only input', () => {
    expect(normalizeShortcutToken('')).toBeUndefined()
    expect(normalizeShortcutToken('   ')).toBeUndefined()
  })

  it('resolves known aliases', () => {
    expect(normalizeShortcutToken('Cmd')).toBe('Command')
    expect(normalizeShortcutToken('cmd')).toBe('Command')
    expect(normalizeShortcutToken('Control')).toBe('Ctrl')
    expect(normalizeShortcutToken('Option')).toBe('Alt')
    expect(normalizeShortcutToken('AltGraph')).toBe('AltGr')
    expect(normalizeShortcutToken('Esc')).toBe('Escape')
    expect(normalizeShortcutToken('Spacebar')).toBe('Space')
    expect(normalizeShortcutToken('ArrowUp')).toBe('Up')
    expect(normalizeShortcutToken('ArrowRight')).toBe('Right')
    expect(normalizeShortcutToken('NumpadAdd')).toBe('numadd')
    expect(normalizeShortcutToken('Subtract')).toBe('numsub')
    expect(normalizeShortcutToken('Slash')).toBe('/')
    expect(normalizeShortcutToken('BracketLeft')).toBe('[')
    expect(normalizeShortcutToken('Backquote')).toBe('`')
  })

  it('resolves tokens case-insensitively via the lowercase map', () => {
    expect(normalizeShortcutToken('shift')).toBe('Shift')
    expect(normalizeShortcutToken('ENTER')).toBe('Enter')
    expect(normalizeShortcutToken('pageup')).toBe('PageUp')
  })

  it('maps DOM codes that are not plain aliases', () => {
    expect(normalizeShortcutToken('NumpadEnter')).toBe('Enter')
  })

  it('extracts the letter from KeyX DOM codes', () => {
    expect(normalizeShortcutToken('KeyA')).toBe('A')
    expect(normalizeShortcutToken('KeyZ')).toBe('Z')
  })

  it('extracts the digit from Digit/Numpad DOM codes', () => {
    expect(normalizeShortcutToken('Digit5')).toBe('5')
    expect(normalizeShortcutToken('Numpad9')).toBe('9')
  })

  it('uppercases single letters and function keys', () => {
    expect(normalizeShortcutToken('a')).toBe('A')
    expect(normalizeShortcutToken('f3')).toBe('F3')
    expect(normalizeShortcutToken('f12')).toBe('F12')
  })

  it('covers the lowercase fallback branch for special tokens', () => {
    expect(normalizeShortcutToken('commandorcontrol')).toBe('CommandOrControl')
    expect(normalizeShortcutToken('altgr')).toBe('AltGr')
    expect(normalizeShortcutToken('numadd')).toBe('numadd')
    expect(normalizeShortcutToken('numsub')).toBe('numsub')
  })

  it('returns undefined for unrecognized input', () => {
    expect(normalizeShortcutToken('NotAKey')).toBeUndefined()
    expect(normalizeShortcutToken('F13')).toBeUndefined()
    expect(normalizeShortcutToken('Key1')).toBeUndefined()
  })
})

describe('normalizeShortcutBinding', () => {
  it('normalizes every token in a valid array', () => {
    expect(normalizeShortcutBinding(['Cmd', 'KeyN'])).toEqual(['Command', 'N'])
    expect(normalizeShortcutBinding(['Control', 'shift', 'a'])).toEqual(['Ctrl', 'Shift', 'A'])
  })

  it('returns [] when the value is not an array', () => {
    expect(normalizeShortcutBinding(undefined)).toEqual([])
    expect(normalizeShortcutBinding(null)).toEqual([])
    expect(normalizeShortcutBinding('Shift')).toEqual([])
    expect(normalizeShortcutBinding({ 0: 'Shift' })).toEqual([])
  })

  it('returns [] when any item is not a string', () => {
    expect(normalizeShortcutBinding(['Shift', 5])).toEqual([])
    expect(normalizeShortcutBinding([null])).toEqual([])
  })

  it('returns [] when any token fails to normalize', () => {
    expect(normalizeShortcutBinding(['Shift', 'NotAKey'])).toEqual([])
    expect(normalizeShortcutBinding(['', 'A'])).toEqual([])
  })

  it('returns [] for an empty array', () => {
    expect(normalizeShortcutBinding([])).toEqual([])
  })
})

describe('isValidShortcut', () => {
  it('accepts a modifier combined with a non-modifier', () => {
    expect(isValidShortcut(['CommandOrControl', 'N'])).toBe(true)
    expect(isValidShortcut(['Shift', 'Alt', '/'])).toBe(true)
  })

  it('accepts a lone Escape or function key', () => {
    expect(isValidShortcut(['Escape'])).toBe(true)
    expect(isValidShortcut(['F5'])).toBe(true)
  })

  it('rejects an empty binding', () => {
    expect(isValidShortcut([])).toBe(false)
  })

  it('rejects bindings containing an unknown token', () => {
    expect(isValidShortcut(['CommandOrControl', 'NotAKey' as never])).toBe(false)
  })

  it('rejects bindings with duplicate tokens', () => {
    expect(isValidShortcut(['Shift', 'Shift'])).toBe(false)
  })

  it('rejects a single non-modifier, non-special key', () => {
    expect(isValidShortcut(['N'])).toBe(false)
  })

  it('rejects modifier-only bindings', () => {
    expect(isValidShortcut(['CommandOrControl', 'Shift'])).toBe(false)
  })
})

describe('convertAcceleratorToHotkey', () => {
  it('maps modifier tokens to hotkey aliases', () => {
    const binding: ShortcutBinding = ['CommandOrControl', 'Shift', 'N']
    expect(convertAcceleratorToHotkey(binding)).toBe('mod+shift+n')
  })

  it('maps Command and Meta to meta, Ctrl to ctrl', () => {
    expect(convertAcceleratorToHotkey(['Command', 'A'])).toBe('meta+a')
    expect(convertAcceleratorToHotkey(['Meta', 'A'])).toBe('meta+a')
    expect(convertAcceleratorToHotkey(['Ctrl', 'A'])).toBe('ctrl+a')
    expect(convertAcceleratorToHotkey(['Alt', 'A'])).toBe('alt+a')
  })

  it('lowercases non-modifier tokens via the default branch', () => {
    expect(convertAcceleratorToHotkey(['F5'])).toBe('f5')
    expect(convertAcceleratorToHotkey(['Escape'])).toBe('escape')
    expect(convertAcceleratorToHotkey(['Up'])).toBe('up')
  })

  it('returns an empty string for an empty accelerator', () => {
    expect(convertAcceleratorToHotkey([])).toBe('')
  })
})
