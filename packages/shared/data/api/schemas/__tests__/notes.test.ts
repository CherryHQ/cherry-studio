import { describe, expect, it } from 'vitest'

import { UpsertNoteSchema } from '../notes'

describe('note DTO schemas', () => {
  it('rejects empty upsert payloads', () => {
    expect(() => UpsertNoteSchema.parse({ rootPath: '/notes', path: 'a.md' })).toThrow(
      'At least one note field is required'
    )
  })

  it('accepts starred or expanded updates', () => {
    expect(UpsertNoteSchema.parse({ rootPath: '/notes', path: 'a.md', isStarred: true })).toEqual({
      rootPath: '/notes',
      path: 'a.md',
      isStarred: true
    })

    expect(UpsertNoteSchema.parse({ rootPath: '/notes', path: 'a.md', isExpanded: false })).toEqual({
      rootPath: '/notes',
      path: 'a.md',
      isExpanded: false
    })
  })
})
