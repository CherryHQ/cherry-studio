import { describe, expect, it } from 'vitest'

import { hasDictationCommandConflict } from '../dictationShortcut'

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
