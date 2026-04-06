import { describe, expect, it } from 'vitest'

import {
  FileEntryIdSchema,
  FileEntrySchema,
  MountSchema,
  MountTypeSchema,
  SafeNameSchema,
  SystemKeySchema
} from '../file'

/**
 * Helper to build a minimal valid file entry for testing name validation.
 * Only the `name` field varies; all other fields are valid constants.
 */
function makeFileEntry(name: string) {
  return {
    id: '019606a0-0000-7000-8000-000000000001',
    type: 'file' as const,
    name,
    ext: 'txt',
    parentId: '019606a0-0000-7000-8000-000000000002',
    mountId: '019606a0-0000-7000-8000-000000000003',
    size: 100,
    remoteId: null,
    cachedAt: null,
    trashedAt: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  }
}

describe('SafeNameSchema validation', () => {
  describe('FileEntrySchema.name', () => {
    it('accepts a normal filename', () => {
      expect(FileEntrySchema.safeParse(makeFileEntry('my-document')).success).toBe(true)
    })

    it('accepts filenames with spaces and unicode', () => {
      expect(FileEntrySchema.safeParse(makeFileEntry('我的文档 (copy)')).success).toBe(true)
    })

    it('accepts filenames with dots (not traversal)', () => {
      expect(FileEntrySchema.safeParse(makeFileEntry('file.backup.old')).success).toBe(true)
    })

    it('accepts triple-dot filename', () => {
      expect(FileEntrySchema.safeParse(makeFileEntry('...')).success).toBe(true)
    })

    it('rejects empty name', () => {
      expect(FileEntrySchema.safeParse(makeFileEntry('')).success).toBe(false)
    })

    it('rejects null byte in name', () => {
      expect(FileEntrySchema.safeParse(makeFileEntry('file\0evil')).success).toBe(false)
    })

    it('rejects forward slash in name', () => {
      expect(FileEntrySchema.safeParse(makeFileEntry('a/b')).success).toBe(false)
    })

    it('rejects backslash in name', () => {
      expect(FileEntrySchema.safeParse(makeFileEntry('a\\b')).success).toBe(false)
    })

    it('rejects dot-dot name', () => {
      expect(FileEntrySchema.safeParse(makeFileEntry('..')).success).toBe(false)
    })

    it('rejects name over 255 chars', () => {
      expect(FileEntrySchema.safeParse(makeFileEntry('x'.repeat(256))).success).toBe(false)
    })

    it('rejects whitespace-only name', () => {
      expect(FileEntrySchema.safeParse(makeFileEntry('   ')).success).toBe(false)
    })

    it('rejects tab-only name', () => {
      expect(FileEntrySchema.safeParse(makeFileEntry('\t')).success).toBe(false)
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

// ─── Helpers for type invariant / trash tests ───

const VALID_UUID_V7 = '019606a0-0000-7000-8000-000000000001'
const VALID_UUID_V7_2 = '019606a0-0000-7000-8000-000000000002'
const VALID_UUID_V7_3 = '019606a0-0000-7000-8000-000000000003'
const TS = 1700000000000

function makeDir(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID_V7,
    type: 'dir',
    name: 'docs',
    ext: null,
    parentId: VALID_UUID_V7_2,
    mountId: VALID_UUID_V7_3,
    size: null,
    remoteId: null,
    cachedAt: null,
    trashedAt: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

function makeFile(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID_V7,
    type: 'file',
    name: 'readme',
    ext: 'md',
    parentId: VALID_UUID_V7_2,
    mountId: VALID_UUID_V7_3,
    size: 1024,
    remoteId: null,
    cachedAt: null,
    trashedAt: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

describe('FileEntrySchema type invariants', () => {
  describe('dir', () => {
    it('accepts a valid dir entry', () => {
      expect(FileEntrySchema.safeParse(makeDir()).success).toBe(true)
    })

    it('accepts dir with null parentId (mount root child)', () => {
      expect(FileEntrySchema.safeParse(makeDir({ parentId: null })).success).toBe(true)
    })

    it('accepts dir with remoteId (remote directories have IDs)', () => {
      expect(FileEntrySchema.safeParse(makeDir({ remoteId: 'folder-123' })).success).toBe(true)
    })

    it('accepts dir with cachedAt (remote directories have cache state)', () => {
      expect(FileEntrySchema.safeParse(makeDir({ cachedAt: TS })).success).toBe(true)
    })

    it('rejects dir with non-null ext', () => {
      const result = FileEntrySchema.safeParse(makeDir({ ext: 'txt' }))
      expect(result.success).toBe(false)
    })

    it('rejects dir with non-null size', () => {
      const result = FileEntrySchema.safeParse(makeDir({ size: 100 }))
      expect(result.success).toBe(false)
    })
  })

  describe('file', () => {
    it('accepts a valid file entry', () => {
      expect(FileEntrySchema.safeParse(makeFile()).success).toBe(true)
    })

    it('accepts file with null ext (extensionless files like Dockerfile)', () => {
      expect(FileEntrySchema.safeParse(makeFile({ ext: null })).success).toBe(true)
    })

    it('accepts file with null size', () => {
      expect(FileEntrySchema.safeParse(makeFile({ size: null })).success).toBe(true)
    })
  })

  describe('type discrimination', () => {
    it('rejects unknown type', () => {
      expect(FileEntrySchema.safeParse(makeFile({ type: 'mount' })).success).toBe(false)
      expect(FileEntrySchema.safeParse(makeFile({ type: 'unknown' })).success).toBe(false)
    })
  })
})

describe('FileEntrySchema trash (trashedAt)', () => {
  it('accepts active entry (trashedAt = null)', () => {
    expect(FileEntrySchema.safeParse(makeFile({ trashedAt: null })).success).toBe(true)
  })

  it('accepts trashed entry (trashedAt = timestamp)', () => {
    expect(FileEntrySchema.safeParse(makeFile({ trashedAt: TS })).success).toBe(true)
  })

  it('parentId does not change when trashed', () => {
    const trashed = makeFile({ trashedAt: TS })
    expect(trashed.parentId).toBe(VALID_UUID_V7_2) // unchanged
    expect(FileEntrySchema.safeParse(trashed).success).toBe(true)
  })

  it('accepts trashed dir', () => {
    expect(FileEntrySchema.safeParse(makeDir({ trashedAt: TS })).success).toBe(true)
  })
})

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

  it('rejects old system entry IDs (no longer valid entry IDs)', () => {
    expect(FileEntryIdSchema.safeParse('mount_files').success).toBe(false)
    expect(FileEntryIdSchema.safeParse('system_trash').success).toBe(false)
  })
})

describe('MountSchema', () => {
  it('accepts a valid local_managed mount', () => {
    const result = MountSchema.safeParse({
      id: VALID_UUID_V7,
      systemKey: 'files',
      name: 'Files',
      mountType: 'local_managed',
      basePath: '/data/files',
      watch: null,
      watchExtensions: null,
      apiType: null,
      providerId: null,
      cachePath: null,
      autoSync: null,
      remoteOptions: null,
      createdAt: TS,
      updatedAt: TS
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid local_external mount', () => {
    const result = MountSchema.safeParse({
      id: VALID_UUID_V7,
      systemKey: 'notes',
      name: 'Notes',
      mountType: 'local_external',
      basePath: '/home/user/notes',
      watch: true,
      watchExtensions: ['md', 'txt'],
      apiType: null,
      providerId: null,
      cachePath: null,
      autoSync: null,
      remoteOptions: null,
      createdAt: TS,
      updatedAt: TS
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid system mount', () => {
    const result = MountSchema.safeParse({
      id: VALID_UUID_V7,
      systemKey: 'trash',
      name: 'Trash',
      mountType: 'system',
      basePath: null,
      watch: null,
      watchExtensions: null,
      apiType: null,
      providerId: null,
      cachePath: null,
      autoSync: null,
      remoteOptions: null,
      createdAt: TS,
      updatedAt: TS
    })
    expect(result.success).toBe(true)
  })

  it('accepts user-created mount (systemKey = null)', () => {
    const result = MountSchema.safeParse({
      id: VALID_UUID_V7,
      systemKey: null,
      name: 'My Obsidian Vault',
      mountType: 'local_external',
      basePath: '/home/user/obsidian',
      watch: true,
      watchExtensions: [],
      apiType: null,
      providerId: null,
      cachePath: null,
      autoSync: null,
      remoteOptions: null,
      createdAt: TS,
      updatedAt: TS
    })
    expect(result.success).toBe(true)
  })

  it('rejects relative basePath', () => {
    const result = MountSchema.safeParse({
      id: VALID_UUID_V7,
      systemKey: 'files',
      name: 'Files',
      mountType: 'local_managed',
      basePath: 'relative/path',
      watch: null,
      watchExtensions: null,
      apiType: null,
      providerId: null,
      cachePath: null,
      autoSync: null,
      remoteOptions: null,
      createdAt: TS,
      updatedAt: TS
    })
    expect(result.success).toBe(false)
  })

  it('rejects local_managed with null basePath', () => {
    const result = MountSchema.safeParse({
      id: VALID_UUID_V7,
      systemKey: 'files',
      name: 'Files',
      mountType: 'local_managed',
      basePath: null,
      watch: null,
      watchExtensions: null,
      apiType: null,
      providerId: null,
      cachePath: null,
      autoSync: null,
      remoteOptions: null,
      createdAt: TS,
      updatedAt: TS
    })
    expect(result.success).toBe(false)
  })

  it('rejects remote with null apiType', () => {
    const result = MountSchema.safeParse({
      id: VALID_UUID_V7,
      systemKey: null,
      name: 'Remote',
      mountType: 'remote',
      basePath: null,
      watch: null,
      watchExtensions: null,
      apiType: null,
      providerId: 'p1',
      cachePath: null,
      autoSync: null,
      remoteOptions: null,
      createdAt: TS,
      updatedAt: TS
    })
    expect(result.success).toBe(false)
  })

  it('rejects remote with null providerId', () => {
    const result = MountSchema.safeParse({
      id: VALID_UUID_V7,
      systemKey: null,
      name: 'Remote',
      mountType: 'remote',
      basePath: null,
      watch: null,
      watchExtensions: null,
      apiType: 'openai_files',
      providerId: null,
      cachePath: null,
      autoSync: null,
      remoteOptions: null,
      createdAt: TS,
      updatedAt: TS
    })
    expect(result.success).toBe(false)
  })
})

describe('MountTypeSchema', () => {
  it('accepts valid mount types', () => {
    expect(MountTypeSchema.safeParse('local_managed').success).toBe(true)
    expect(MountTypeSchema.safeParse('local_external').success).toBe(true)
    expect(MountTypeSchema.safeParse('remote').success).toBe(true)
    expect(MountTypeSchema.safeParse('system').success).toBe(true)
  })

  it('rejects unknown mount type', () => {
    expect(MountTypeSchema.safeParse('unknown').success).toBe(false)
  })
})

describe('SystemKeySchema', () => {
  it('accepts valid system keys', () => {
    expect(SystemKeySchema.safeParse('files').success).toBe(true)
    expect(SystemKeySchema.safeParse('notes').success).toBe(true)
    expect(SystemKeySchema.safeParse('temp').success).toBe(true)
    expect(SystemKeySchema.safeParse('trash').success).toBe(true)
  })

  it('rejects unknown system key', () => {
    expect(SystemKeySchema.safeParse('unknown').success).toBe(false)
  })
})
