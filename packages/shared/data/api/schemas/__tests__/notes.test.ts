import { describe, expect, it } from 'vitest'

import { DeleteNoteQuerySchema, ListNoteQuerySchema, RewriteNotePathSchema, UpsertNoteSchema } from '../notes'

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

  it('rejects blank paths', () => {
    expect(() => ListNoteQuerySchema.parse({ rootPath: '   ' })).toThrow('path must not be blank')
    expect(() => UpsertNoteSchema.parse({ rootPath: '/notes', path: '   ', isStarred: true })).toThrow(
      'path must not be blank'
    )
    expect(() => DeleteNoteQuerySchema.parse({ rootPath: '/notes', path: '   ' })).toThrow('path must not be blank')
    expect(() => RewriteNotePathSchema.parse({ rootPath: '/notes', fromPath: 'a.md', toPath: '   ' })).toThrow(
      'path must not be blank'
    )
  })
})
