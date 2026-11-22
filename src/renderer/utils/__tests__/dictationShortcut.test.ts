import { describe, expect, it } from 'vitest'

import { hasDictationCommandConflict, parseDictationShortcut } from '../dictationShortcut'

describe('dictation shortcut parsing', () => {
  it.each(['constructor', '__proto__', 'toString'])('rejects inherited token name %s in a chord', (name) => {
    expect(parseDictationShortcut(`ControlLeft+${name}`)).toEqual([])
  })
})

describe('dictation command conflicts', () => {
  it('detects command bindings contained in a longer dictation chord', () => {
    const keyByCode = new Map([['KeyN', 'n']])
    const options = {
      platform: 'win32',
      context: {},
      preferences: { 'app.search': { binding: ['CommandOrControl', 'N'], enabled: true } }
    } satisfies Parameters<typeof hasDictationCommandConflict>[1]

    expect(hasDictationCommandConflict('ControlLeft+ShiftLeft+KeyN', options, keyByCode)).toBe(true)
    expect(hasDictationCommandConflict('AltLeft+ShiftLeft+KeyN', options, keyByCode)).toBe(false)
  })
})
