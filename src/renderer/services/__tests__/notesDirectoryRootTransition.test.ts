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

  it('returns the shared chain for the matching target root', () => {
    recordNotesDirectoryRootTransition('/old/notes', '/new/notes')

    expect(consumeNotesDirectoryRootTransition('/new/notes')).toEqual(['/old/notes', '/new/notes'])
    expect(consumeNotesDirectoryRootTransition('/new/notes')).toEqual(['/old/notes', '/new/notes'])
  })

  it('returns null when the expected target does not match', () => {
    recordNotesDirectoryRootTransition('/old/notes', '/new/notes')
    expect(consumeNotesDirectoryRootTransition('/other/notes')).toBeNull()
  })

  it('keeps every root of a consecutive chain so intermediate selections survive', () => {
    recordNotesDirectoryRootTransition('/a/notes', '/b/notes')
    recordNotesDirectoryRootTransition('/b/notes', '/c/notes')

    expect(consumeNotesDirectoryRootTransition('/c/notes')).toEqual(['/a/notes', '/b/notes', '/c/notes'])
  })

  it('restarts the chain when a transition does not continue the previous one', () => {
    recordNotesDirectoryRootTransition('/a/notes', '/b/notes')
    recordNotesDirectoryRootTransition('/unrelated/notes', '/c/notes')

    expect(consumeNotesDirectoryRootTransition('/c/notes')).toEqual(['/unrelated/notes', '/c/notes'])
  })
})
