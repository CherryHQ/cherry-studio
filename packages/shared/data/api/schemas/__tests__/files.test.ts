import { describe, expect, it } from 'vitest'

import { ListFilesQuerySchema } from '../files'

describe('ListFilesQuerySchema', () => {
  it('accepts a query without origin or inTrash', () => {
    const result = ListFilesQuerySchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts inTrash=true with origin=internal', () => {
    expect(ListFilesQuerySchema.safeParse({ inTrash: true, origin: 'internal' }).success).toBe(true)
  })

  it('accepts inTrash=true with no origin specified (means "any origin where trashed makes sense")', () => {
    expect(ListFilesQuerySchema.safeParse({ inTrash: true }).success).toBe(true)
  })

  it('accepts inTrash=false with origin=external', () => {
    expect(ListFilesQuerySchema.safeParse({ inTrash: false, origin: 'external' }).success).toBe(true)
  })

  it('rejects the impossible combo inTrash=true && origin=external (S6 refine)', () => {
    // DB CHECK fe_external_no_trash makes this combo always return zero
    // rows; the refine surfaces the contradiction at the parse boundary
    // instead of silently returning empty results to callers.
    const result = ListFilesQuerySchema.safeParse({ inTrash: true, origin: 'external' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/external entries cannot be trashed/i)
    }
  })
})
