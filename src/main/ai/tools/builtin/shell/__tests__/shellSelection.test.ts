import { describe, expect, it } from 'vitest'

import { selectShell } from '../shellSelection'

describe('selectShell', () => {
  it('uses pwsh on win32', () => {
    expect(selectShell({ platform: 'win32' })).toEqual({ shell: 'pwsh', flag: '-Command' })
  })

  it('honours $SHELL on unix-likes', () => {
    expect(selectShell({ platform: 'darwin', envShell: '/bin/zsh' })).toEqual({ shell: '/bin/zsh', flag: '-c' })
    expect(selectShell({ platform: 'linux', envShell: '/usr/bin/fish' })).toEqual({
      shell: '/usr/bin/fish',
      flag: '-c'
    })
  })

  it('falls back to /bin/bash when SHELL is unset', () => {
    const original = process.env.SHELL
    delete process.env.SHELL
    try {
      expect(selectShell({ platform: 'linux', envShell: undefined })).toEqual({ shell: '/bin/bash', flag: '-c' })
    } finally {
      if (original !== undefined) process.env.SHELL = original
    }
  })
})
