import { beforeEach, describe, expect, it } from 'vitest'

import { cacheService } from '@renderer/data/CacheService'

import {
  consumeNotesDirectoryRootTransition,
  recordNotesDirectoryRootTransition
} from '../notesDirectoryRootTransition'

describe('notesDirectoryRootTransition', () => {
  beforeEach(() => {
    cacheService.deleteShared('notes.directory_root_transition')
    cacheService.setPersist('notes.directory_root_transition_consumed_id', null)
  })

  it('lets each renderer window consume the same migration transition once', () => {
    recordNotesDirectoryRootTransition('/old/notes', '/new/notes')

    expect(consumeNotesDirectoryRootTransition('/new/notes')).toEqual({
      from: '/old/notes',
      to: '/new/notes'
    })
    expect(consumeNotesDirectoryRootTransition('/new/notes')).toBeNull()

    cacheService.setPersist('notes.directory_root_transition_consumed_id', null)

    expect(consumeNotesDirectoryRootTransition('/new/notes')).toEqual({
      from: '/old/notes',
      to: '/new/notes'
    })
  })
})
