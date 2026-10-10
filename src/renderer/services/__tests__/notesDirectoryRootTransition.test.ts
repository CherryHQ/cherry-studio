import { beforeEach, describe, expect, it } from 'vitest'

import { cacheService } from '@renderer/data/CacheService'

import {
  consumeNotesDirectoryRootTransition,
  recordNotesDirectoryRootTransition
} from '../notesDirectoryRootTransition'

describe('notesDirectoryRootTransition', () => {
  beforeEach(() => {
    cacheService.deleteShared('notes.directory_root_transition')
  })

  it('returns the shared transition for the matching target root', () => {
    recordNotesDirectoryRootTransition('/old/notes', '/new/notes')

    expect(consumeNotesDirectoryRootTransition('/new/notes')).toEqual({
      from: '/old/notes',
      to: '/new/notes'
    })
    expect(consumeNotesDirectoryRootTransition('/new/notes')).toEqual({
      from: '/old/notes',
      to: '/new/notes'
    })
  })

  it('returns null when the expected target does not match', () => {
    recordNotesDirectoryRootTransition('/old/notes', '/new/notes')
    expect(consumeNotesDirectoryRootTransition('/other/notes')).toBeNull()
  })
})
