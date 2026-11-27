import { describe, expect, it } from 'vitest'

import { FileTypeSchema } from '@shared/types/file'

describe('FileTypeSchema', () => {
  it('rejects unknown file types', () => {
    expect(FileTypeSchema.safeParse('markdown').success).toBe(false)
  })
})
