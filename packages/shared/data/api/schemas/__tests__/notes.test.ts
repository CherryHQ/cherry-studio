import { describe, expect, it } from 'vitest'

import { DeleteNoteQuerySchema, ListNoteQuerySchema, RewriteNotePathSchema, UpsertNoteSchema } from '../notes'

describe('note DTO schemas', () => {
  it('rejects empty upsert payloads', () => {
    expect(() => UpsertNoteSchema.parse({ rootPath: '/notes', path: 'a.md' })).toThrow(
      'At least one note field is required'
    )
  })

  it('accepts starred or expanded updates', () => {
    expect(UpsertNoteSchema.parse({ rootPath: ' /notes ', path: ' a.md ', isStarred: true })).toEqual({
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

  it('rejects paths over the API length limit', () => {
    const longPath = 'a'.repeat(501)

    expect(() => ListNoteQuerySchema.parse({ rootPath: longPath })).toThrow('path is too long')
    expect(() => UpsertNoteSchema.parse({ rootPath: '/notes', path: longPath, isStarred: true })).toThrow(
      'path is too long'
    )
  })

  it('normalizes path separators at the API boundary', () => {
    expect(
      RewriteNotePathSchema.parse({
        rootPath: 'C:\\Users\\test\\Notes',
        fromPath: 'C:\\Users\\test\\Notes\\a.md',
        toPath: 'C:\\Users\\test\\Notes\\b.md'
      })
    ).toEqual({
      rootPath: 'C:/Users/test/Notes',
      fromPath: 'C:/Users/test/Notes/a.md',
      toPath: 'C:/Users/test/Notes/b.md'
    })
  })

  it('rejects rewrite requests where source and target paths are the same', () => {
    expect(() =>
      RewriteNotePathSchema.parse({
        rootPath: '/notes',
        fromPath: '/notes/a.md',
        toPath: '/notes/a.md'
      })
    ).toThrow('fromPath and toPath must differ')
  })

  it('rejects recursive rewrite requests into the source descendant', () => {
    expect(() =>
      RewriteNotePathSchema.parse({
        rootPath: '/notes',
        fromPath: '/notes/folder',
        toPath: '/notes/folder/child',
        recursive: true
      })
    ).toThrow('Cannot rewrite a folder into its own descendant')
  })
})
