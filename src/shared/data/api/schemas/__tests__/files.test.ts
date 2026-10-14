import { describe, expect, it } from 'vitest'

import { LIST_FILES_MAX_LIMIT, ListFilesQuerySchema } from '../files'

describe('ListFilesQuerySchema', () => {
  it('accepts a query without origin or inTrash', () => {
    const result = ListFilesQuerySchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts exact file entry ids up to the collection limit', () => {
    const ids = Array.from(
      { length: LIST_FILES_MAX_LIMIT },
      (_, index) => `019606a0-0000-7000-8000-${String(index).padStart(12, '0')}`
    )

    expect(ListFilesQuerySchema.parse({ ids }).ids).toEqual(ids)
    expect(ListFilesQuerySchema.safeParse({ ids: [] }).success).toBe(false)
    expect(ListFilesQuerySchema.safeParse({ ids: [...ids, crypto.randomUUID()] }).success).toBe(false)
  })

  it('accepts inTrash=true with origin=internal', () => {
    expect(ListFilesQuerySchema.safeParse({ inTrash: true, origin: 'internal' }).success).toBe(true)
  })

  it('accepts inTrash=true with no origin specified (means "any origin where trashed makes sense")', () => {
    expect(ListFilesQuerySchema.safeParse({ inTrash: true }).success).toBe(true)
  })

  it('accepts ext sorting for file format/type column ordering', () => {
    expect(ListFilesQuerySchema.safeParse({ sortBy: 'ext', sortOrder: 'asc' }).success).toBe(true)
  })

  it('accepts a supported file type filter', () => {
    expect(ListFilesQuerySchema.safeParse({ fileType: 'image' }).success).toBe(true)
  })

  it('rejects an unknown file type filter', () => {
    expect(ListFilesQuerySchema.safeParse({ fileType: 'archive' }).success).toBe(false)
  })

  it('accepts inTrash=false with origin=external', () => {
    expect(ListFilesQuerySchema.safeParse({ inTrash: false, origin: 'external' }).success).toBe(true)
  })

  it('rejects the impossible combo inTrash=true && origin=external (S6 refine)', () => {
    // DB CHECK fe_external_no_delete makes this combo always return zero
    // rows; the refine surfaces the contradiction at the parse boundary
    // instead of silently returning empty results to callers.
    const result = ListFilesQuerySchema.safeParse({ inTrash: true, origin: 'external' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/external entries cannot be trashed/i)
    }
  })
})
