import { describe, expect, it } from 'vitest'

import { FILE_TYPE, FileTypeSchema } from '../data/types/file'

describe('FileTypeSchema', () => {
  it('accepts canonical file types', () => {
    expect(FileTypeSchema.safeParse(FILE_TYPE.IMAGE).success).toBe(true)
    expect(FileTypeSchema.safeParse(FILE_TYPE.DOCUMENT).success).toBe(true)
    expect(FileTypeSchema.safeParse(FILE_TYPE.TEXT).success).toBe(true)
  })

  it('rejects unknown file types', () => {
    expect(FileTypeSchema.safeParse('markdown').success).toBe(false)
  })
})
