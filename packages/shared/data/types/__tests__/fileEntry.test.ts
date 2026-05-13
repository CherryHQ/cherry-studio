import { describe, expect, it } from 'vitest'

import { FileEntryIdSchema, FileEntrySchema, SafeNameSchema } from '../file'

// ─── Helpers ───

const VALID_UUID_V7 = '019606a0-0000-7000-8000-000000000001'
const TS = 1700000000000

// After the BO/DB split, each variant's schema declares only its own fields
// (strictObject — extra keys are rejected). Internal has no `externalPath` and
// `trashedAt` is optional; external has no `size` and no `trashedAt`. Factories
// match that shape so callers only set fields that belong on the arm.
function makeInternal(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID_V7,
    origin: 'internal',
    name: 'readme',
    ext: 'md',
    size: 1024,
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
    externalPath: '/Users/me/documents/report.pdf',
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

    it('rejects external with null externalPath (schema requires non-null string)', () => {
      const result = FileEntrySchema.safeParse(makeExternal({ externalPath: null }))
      expect(result.success).toBe(false)
    })

    it('rejects external with absent externalPath (schema requires the field)', () => {
      // strictObject parses external without externalPath as a missing field;
      // discriminator routing still picks the external arm via `origin`.
      const base = makeExternal()
      // biome-ignore lint/performance/noDelete: we want the absent-field semantics
      delete (base as { externalPath?: string }).externalPath
      expect(FileEntrySchema.safeParse(base).success).toBe(false)
    })

    it('rejects external with relative externalPath', () => {
      const result = FileEntrySchema.safeParse(makeExternal({ externalPath: 'relative/path' }))
      expect(result.success).toBe(false)
    })

    it('rejects external with file:// URL (not a filesystem path)', () => {
      const result = FileEntrySchema.safeParse(makeExternal({ externalPath: 'file:///Users/me/file.pdf' }))
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
  // After I19 the internal arm types `trashedAt` as `optional number` — present
  // when trashed, absent (undefined) when live. The external arm drops the
  // field entirely (the DB CHECK fe_external_no_trash already forbids it).

  it('accepts active internal entry (trashedAt absent)', () => {
    expect(FileEntrySchema.safeParse(makeInternal()).success).toBe(true)
  })

  it('accepts trashed internal entry', () => {
    expect(FileEntrySchema.safeParse(makeInternal({ trashedAt: TS })).success).toBe(true)
  })

  it('rejects trashed external entry (strictObject — external has no trashedAt field)', () => {
    expect(FileEntrySchema.safeParse(makeExternal({ trashedAt: TS })).success).toBe(false)
  })

  it('accepts external entry (no trashedAt field by construction)', () => {
    expect(FileEntrySchema.safeParse(makeExternal()).success).toBe(true)
  })
})

// ─── Size / ext boundary checks ───

describe('FileEntrySchema size/ext boundaries', () => {
  // Internal: size is an authoritative byte count.
  it('rejects internal with negative size', () => {
    expect(FileEntrySchema.safeParse(makeInternal({ size: -1 })).success).toBe(false)
  })

  it('rejects internal with non-integer size', () => {
    expect(FileEntrySchema.safeParse(makeInternal({ size: 1.5 })).success).toBe(false)
  })

  it('rejects internal with null size (internal size is SoT, never null)', () => {
    expect(FileEntrySchema.safeParse(makeInternal({ size: null })).success).toBe(false)
  })

  it('rejects internal with absent size (internal size is mandatory)', () => {
    const base = makeInternal()
    // biome-ignore lint/performance/noDelete: we want the absent-field semantics
    delete (base as { size?: number }).size
    expect(FileEntrySchema.safeParse(base).success).toBe(false)
  })

  it('accepts internal size=0 (empty file)', () => {
    expect(FileEntrySchema.safeParse(makeInternal({ size: 0 })).success).toBe(true)
  })

  it('accepts internal size up to MAX_SAFE_INTEGER', () => {
    expect(FileEntrySchema.safeParse(makeInternal({ size: Number.MAX_SAFE_INTEGER })).success).toBe(true)
  })

  // External BO has no `size` field at all — strict mode rejects any value for
  // it, including `null`. Live size comes from File IPC `getMetadata`.
  it('rejects external with null size (strictObject — no size field on external arm)', () => {
    expect(FileEntrySchema.safeParse(makeExternal({ size: null })).success).toBe(false)
  })

  it('rejects external with numeric size (strictObject — no size field on external arm)', () => {
    expect(FileEntrySchema.safeParse(makeExternal({ size: 0 })).success).toBe(false)
    expect(FileEntrySchema.safeParse(makeExternal({ size: 12345 })).success).toBe(false)
  })

  it('rejects empty ext string (use null for extensionless files)', () => {
    expect(FileEntrySchema.safeParse(makeInternal({ ext: '' })).success).toBe(false)
  })

  it('rejects ext with leading dot (convention: bare extension)', () => {
    expect(FileEntrySchema.safeParse(makeInternal({ ext: '.pdf' })).success).toBe(false)
    expect(FileEntrySchema.safeParse(makeExternal({ ext: '.md' })).success).toBe(false)
  })

  it('rejects ext with path separators', () => {
    expect(FileEntrySchema.safeParse(makeInternal({ ext: 'foo/bar' })).success).toBe(false)
    expect(FileEntrySchema.safeParse(makeInternal({ ext: 'foo\\bar' })).success).toBe(false)
  })

  it('rejects ext with null bytes', () => {
    expect(FileEntrySchema.safeParse(makeInternal({ ext: 'pdf\0evil' })).success).toBe(false)
  })

  it('rejects whitespace-only ext (use null for extensionless files)', () => {
    expect(FileEntrySchema.safeParse(makeInternal({ ext: '   ' })).success).toBe(false)
  })

  it('accepts ext with internal dots (e.g. tar.gz convention lives in name, not ext)', () => {
    // `.tar.gz` is split as name='archive.tar', ext='gz' by splitName — this
    // test just confirms the schema itself allows bare multi-letter extensions.
    expect(FileEntrySchema.safeParse(makeInternal({ ext: 'gz' })).success).toBe(true)
    expect(FileEntrySchema.safeParse(makeInternal({ ext: '7z' })).success).toBe(true)
  })
})

// ─── Brand (duck-typing prevention) ───

describe('FileEntrySchema brand', () => {
  it('parsed entry carries brand (type-level guarantee; runtime only checks structure)', () => {
    const result = FileEntrySchema.safeParse(makeInternal())
    expect(result.success).toBe(true)
    // The brand is a compile-time construct — we can't assert it at runtime,
    // but the following assignment would fail type-check if brand were lost:
    //   const typed: FileEntry = { ...makeInternal() } // type error (missing brand)
    //   const typed: FileEntry = result.data!           // OK
  })
})

// ─── FileEntryId ───

describe('FileEntryIdSchema', () => {
  it('accepts UUID v7 (entries created in v2)', () => {
    expect(FileEntryIdSchema.safeParse('019606a0-0000-7000-8000-000000000001').success).toBe(true)
  })

  it('accepts UUID v4 (legacy ids preserved by migration)', () => {
    // The schema accepts any UUID version so cross-table references keep
    // their original ids when data is migrated from legacy stores; new
    // entries created in v2 still come out as v7.
    expect(FileEntryIdSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true)
  })

  it('rejects random strings', () => {
    expect(FileEntryIdSchema.safeParse('not-a-valid-id').success).toBe(false)
    expect(FileEntryIdSchema.safeParse('').success).toBe(false)
  })
})
