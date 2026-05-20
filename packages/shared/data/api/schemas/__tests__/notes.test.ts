import { describe, expect, it } from 'vitest'

import { UpsertNoteMetadataSchema } from '../notes'

describe('note metadata DTO schemas', () => {
  it('rejects empty upsert payloads', () => {
    expect(() => UpsertNoteMetadataSchema.parse({ rootPath: '/notes', path: 'a.md' })).toThrow(
      'At least one note metadata field is required'
    )
  })

  it('accepts starred or expanded updates', () => {
    expect(UpsertNoteMetadataSchema.parse({ rootPath: '/notes', path: 'a.md', isStarred: true })).toEqual({
      rootPath: '/notes',
      path: 'a.md',
      isStarred: true
    })

    expect(UpsertNoteMetadataSchema.parse({ rootPath: '/notes', path: 'a.md', isExpanded: false })).toEqual({
      rootPath: '/notes',
      path: 'a.md',
      isExpanded: false
    })
  })
})
