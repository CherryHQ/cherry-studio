import { describe, expect, it } from 'vitest'

import { guardUpdateFromForm } from '../TaskFormDialog'

describe('guardUpdateFromForm', () => {
  const stored = { type: 'file_changed', path: '/old/file.txt', workspaceRoot: '/old' } as const

  it('omits the guard when the visible fields match the opening values, even if the stored guard carries a root', () => {
    expect(guardUpdateFromForm(stored, 'file_changed', '/old/file.txt')).toBeUndefined()
    expect(guardUpdateFromForm({ type: 'always' }, 'always', '')).toBeUndefined()
    expect(guardUpdateFromForm({ type: 'command', command: 'test -f x' }, 'command', ' test -f x ')).toBeUndefined()
  })

  it('sends a guard when the type or value changed', () => {
    expect(guardUpdateFromForm(stored, 'file_changed', '/new/file.txt')).toEqual({
      type: 'file_changed',
      path: '/new/file.txt'
    })
    expect(guardUpdateFromForm(stored, 'command', 'echo hi')).toEqual({ type: 'command', command: 'echo hi' })
    expect(guardUpdateFromForm(stored, 'always', '')).toEqual({ type: 'always' })
  })
})
