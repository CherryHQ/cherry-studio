import { describe, expect, it } from 'vitest'

import { FileEntryIdSchema, FileEntrySchema, SafeNameSchema } from '../file'

// ─── Helpers ───

const VALID_UUID_V7 = '019606a0-0000-7000-8000-000000000001'
const TS = 1700000000000

function makeInternal(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID_V7,
    origin: 'internal',
    name: 'readme',
    ext: 'md',
    size: 1024,
    externalPath: null,
    trashedAt: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

function makeExternal(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID_V7,
    origin: 'external',
    name: 'report',
    ext: 'pdf',
    size: 50000,
    externalPath: '/Users/me/documents/report.pdf',
    trashedAt: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

// ─── Name validation ───

describe('SafeNameSchema validation', () => {
  describe('FileEntrySchema.name', () => {
    it('accepts a normal filename', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ name: 'my-document' })).success).toBe(true)
    })

    it('accepts filenames with spaces and unicode', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ name: '我的文档 (copy)' })).success).toBe(true)
    })

    it('accepts filenames with dots (not traversal)', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ name: 'file.backup.old' })).success).toBe(true)
    })

    it('accepts triple-dot filename', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ name: '...' })).success).toBe(true)
    })

    it('rejects empty name', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ name: '' })).success).toBe(false)
    })

    it('rejects null byte in name', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ name: 'file\0evil' })).success).toBe(false)
    })

    it('rejects forward slash in name', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ name: 'a/b' })).success).toBe(false)
    })

    it('rejects backslash in name', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ name: 'a\\b' })).success).toBe(false)
    })

    it('rejects dot-dot name', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ name: '..' })).success).toBe(false)
    })

    it('rejects name over 255 chars', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ name: 'x'.repeat(256) })).success).toBe(false)
    })

    it('rejects whitespace-only name', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ name: '   ' })).success).toBe(false)
    })

    it('rejects tab-only name', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ name: '\t' })).success).toBe(false)
    })
  })

  describe('SafeNameSchema (standalone)', () => {
    it('accepts a normal name', () => {
      expect(SafeNameSchema.safeParse('document').success).toBe(true)
    })

    it('rejects null byte in name', () => {
      expect(SafeNameSchema.safeParse('file\0evil').success).toBe(false)
    })

    it('rejects path separator in name', () => {
      expect(SafeNameSchema.safeParse('a/b').success).toBe(false)
    })

    it('rejects backslash in name', () => {
      expect(SafeNameSchema.safeParse('a\\b').success).toBe(false)
    })

    it('rejects dot-dot name', () => {
      expect(SafeNameSchema.safeParse('..').success).toBe(false)
    })

    it('rejects name over 255 chars', () => {
      expect(SafeNameSchema.safeParse('x'.repeat(256)).success).toBe(false)
    })
  })
})

// ─── Origin invariants ───

describe('FileEntrySchema origin invariants', () => {
  describe('internal', () => {
    it('accepts a valid internal entry', () => {
      expect(FileEntrySchema.safeParse(makeInternal()).success).toBe(true)
    })

    it('accepts internal with null ext (extensionless files like Dockerfile)', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ ext: null })).success).toBe(true)
    })

    it('rejects internal with non-null externalPath', () => {
      const result = FileEntrySchema.safeParse(makeInternal({ externalPath: '/some/path' }))
      expect(result.success).toBe(false)
    })
  })

  describe('external', () => {
    it('accepts a valid external entry', () => {
      expect(FileEntrySchema.safeParse(makeExternal()).success).toBe(true)
    })

    it('accepts external with null ext', () => {
      expect(FileEntrySchema.safeParse(makeExternal({ ext: null })).success).toBe(true)
    })

    it('rejects external with null externalPath', () => {
      const result = FileEntrySchema.safeParse(makeExternal({ externalPath: null }))
      expect(result.success).toBe(false)
    })

    it('rejects external with relative externalPath', () => {
      const result = FileEntrySchema.safeParse(makeExternal({ externalPath: 'relative/path' }))
      expect(result.success).toBe(false)
    })
  })

  describe('origin discriminator', () => {
    it('rejects unknown origin', () => {
      expect(FileEntrySchema.safeParse(makeInternal({ origin: 'unknown' })).success).toBe(false)
      expect(FileEntrySchema.safeParse(makeInternal({ origin: 'remote' })).success).toBe(false)
    })
  })
})

// ─── Trash ───

describe('FileEntrySchema trash (trashedAt)', () => {
  it('accepts active entry (trashedAt = null)', () => {
    expect(FileEntrySchema.safeParse(makeInternal({ trashedAt: null })).success).toBe(true)
  })

  it('accepts trashed internal entry', () => {
    expect(FileEntrySchema.safeParse(makeInternal({ trashedAt: TS })).success).toBe(true)
  })

  it('accepts trashed external entry', () => {
    expect(FileEntrySchema.safeParse(makeExternal({ trashedAt: TS })).success).toBe(true)
  })
})

// ─── FileEntryId ───

describe('FileEntryIdSchema', () => {
  it('accepts UUID v7', () => {
    expect(FileEntryIdSchema.safeParse('019606a0-0000-7000-8000-000000000001').success).toBe(true)
  })

  it('rejects UUID v4', () => {
    expect(FileEntryIdSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(false)
  })

  it('rejects random strings', () => {
    expect(FileEntryIdSchema.safeParse('not-a-valid-id').success).toBe(false)
    expect(FileEntryIdSchema.safeParse('').success).toBe(false)
  })
})
