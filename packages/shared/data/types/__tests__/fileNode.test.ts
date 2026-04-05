import { describe, expect, it } from 'vitest'

import { CreateNodeDtoSchema, UpdateNodeDtoSchema } from '../../api/schemas/files'
import {
  FileTreeNodeSchema,
  LocalExternalConfigSchema,
  LocalManagedConfigSchema,
  MountProviderConfigSchema,
  NodeIdSchema,
  RemoteConfigSchema,
  SystemConfigSchema
} from '../file'

/**
 * Helper to build a minimal valid file node for testing name validation.
 * Only the `name` field varies; all other fields are valid constants.
 */
function makeFileNode(name: string) {
  return {
    id: '019606a0-0000-7000-8000-000000000001',
    type: 'file' as const,
    name,
    ext: 'txt',
    parentId: '019606a0-0000-7000-8000-000000000002',
    mountId: '019606a0-0000-7000-8000-000000000003',
    size: 100,
    providerConfig: null,
    remoteId: null,
    cachedAt: null,
    previousParentId: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  }
}

function makeCreateDto(name: string) {
  return {
    type: 'file' as const,
    name,
    parentId: '019606a0-0000-7000-8000-000000000002'
  }
}

describe('SafeNameSchema validation', () => {
  describe('FileTreeNodeSchema.name', () => {
    it('accepts a normal filename', () => {
      const result = FileTreeNodeSchema.safeParse(makeFileNode('my-document'))
      expect(result.success).toBe(true)
    })

    it('accepts filenames with spaces and unicode', () => {
      const result = FileTreeNodeSchema.safeParse(makeFileNode('我的文档 (copy)'))
      expect(result.success).toBe(true)
    })

    it('accepts filenames with dots (not traversal)', () => {
      const result = FileTreeNodeSchema.safeParse(makeFileNode('file.backup.old'))
      expect(result.success).toBe(true)
    })

    it('accepts triple-dot filename', () => {
      const result = FileTreeNodeSchema.safeParse(makeFileNode('...'))
      expect(result.success).toBe(true)
    })

    it('rejects empty name', () => {
      const result = FileTreeNodeSchema.safeParse(makeFileNode(''))
      expect(result.success).toBe(false)
    })

    it('rejects name exceeding 255 characters', () => {
      const result = FileTreeNodeSchema.safeParse(makeFileNode('a'.repeat(256)))
      expect(result.success).toBe(false)
    })

    it('accepts name at exactly 255 characters', () => {
      const result = FileTreeNodeSchema.safeParse(makeFileNode('a'.repeat(255)))
      expect(result.success).toBe(true)
    })

    it('rejects name containing null byte', () => {
      const result = FileTreeNodeSchema.safeParse(makeFileNode('file\0evil'))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.message.includes('null bytes'))).toBe(true)
    })

    it('rejects name containing forward slash', () => {
      const result = FileTreeNodeSchema.safeParse(makeFileNode('path/to/file'))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.message.includes('path separators'))).toBe(true)
    })

    it('rejects name containing backslash', () => {
      const result = FileTreeNodeSchema.safeParse(makeFileNode('path\\to\\file'))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.message.includes('path separators'))).toBe(true)
    })

    it('rejects name that is single dot', () => {
      const result = FileTreeNodeSchema.safeParse(makeFileNode('.'))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.message.includes('. or ..'))).toBe(true)
    })

    it('rejects name that is double dot', () => {
      const result = FileTreeNodeSchema.safeParse(makeFileNode('..'))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.message.includes('. or ..'))).toBe(true)
    })

    it('rejects traversal sequence ../../etc/passwd', () => {
      const result = FileTreeNodeSchema.safeParse(makeFileNode('../../etc/passwd'))
      expect(result.success).toBe(false)
    })

    it('rejects whitespace-only name', () => {
      expect(FileTreeNodeSchema.safeParse(makeFileNode('   ')).success).toBe(false)
      expect(FileTreeNodeSchema.safeParse(makeFileNode('\t')).success).toBe(false)
    })
  })

  describe('CreateNodeDtoSchema.name', () => {
    it('accepts a normal name', () => {
      const result = CreateNodeDtoSchema.safeParse(makeCreateDto('document'))
      expect(result.success).toBe(true)
    })

    it('rejects null byte in name', () => {
      const result = CreateNodeDtoSchema.safeParse(makeCreateDto('file\0evil'))
      expect(result.success).toBe(false)
    })

    it('rejects path separator in name', () => {
      const result = CreateNodeDtoSchema.safeParse(makeCreateDto('a/b'))
      expect(result.success).toBe(false)
    })

    it('rejects dot-dot name', () => {
      const result = CreateNodeDtoSchema.safeParse(makeCreateDto('..'))
      expect(result.success).toBe(false)
    })

    it('rejects name over 255 chars', () => {
      const result = CreateNodeDtoSchema.safeParse(makeCreateDto('x'.repeat(256)))
      expect(result.success).toBe(false)
    })
  })

  describe('UpdateNodeDtoSchema.name', () => {
    it('accepts a normal name', () => {
      const result = UpdateNodeDtoSchema.safeParse({ name: 'renamed' })
      expect(result.success).toBe(true)
    })

    it('accepts omitted name (optional)', () => {
      const result = UpdateNodeDtoSchema.safeParse({ ext: 'md' })
      expect(result.success).toBe(true)
    })

    it('rejects null byte in name', () => {
      const result = UpdateNodeDtoSchema.safeParse({ name: 'file\0evil' })
      expect(result.success).toBe(false)
    })

    it('rejects path separator in name', () => {
      const result = UpdateNodeDtoSchema.safeParse({ name: 'a\\b' })
      expect(result.success).toBe(false)
    })

    it('rejects dot-dot name', () => {
      const result = UpdateNodeDtoSchema.safeParse({ name: '..' })
      expect(result.success).toBe(false)
    })
  })
})

// ─── Helpers for type invariant / trash tests ───

const VALID_UUID_V7 = '019606a0-0000-7000-8000-000000000001'
const VALID_UUID_V7_2 = '019606a0-0000-7000-8000-000000000002'
const VALID_UUID_V7_3 = '019606a0-0000-7000-8000-000000000003'
const TS = 1700000000000

function makeMount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mount_files',
    type: 'mount',
    name: 'Files',
    ext: null,
    parentId: null,
    mountId: 'mount_files',
    size: null,
    providerConfig: { providerType: 'local_managed', basePath: '/data/files' },
    remoteId: null,
    cachedAt: null,
    previousParentId: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

function makeDir(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID_V7,
    type: 'dir',
    name: 'docs',
    ext: null,
    parentId: VALID_UUID_V7_2,
    mountId: VALID_UUID_V7_3,
    size: null,
    providerConfig: null,
    remoteId: null,
    cachedAt: null,
    previousParentId: null,
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
    providerConfig: null,
    remoteId: null,
    cachedAt: null,
    previousParentId: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

describe('FileTreeNodeSchema type invariants', () => {
  describe('mount', () => {
    it('accepts a valid mount node', () => {
      expect(FileTreeNodeSchema.safeParse(makeMount()).success).toBe(true)
    })

    it('rejects mount with non-null parentId', () => {
      const result = FileTreeNodeSchema.safeParse(makeMount({ parentId: VALID_UUID_V7 }))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.path.includes('parentId'))).toBe(true)
    })

    it('rejects mount with mountId ≠ own id', () => {
      const result = FileTreeNodeSchema.safeParse(makeMount({ mountId: VALID_UUID_V7 }))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.path.includes('mountId'))).toBe(true)
    })

    it('rejects mount with null providerConfig', () => {
      const result = FileTreeNodeSchema.safeParse(makeMount({ providerConfig: null }))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.path.includes('providerConfig'))).toBe(true)
    })

    it('rejects mount with non-null ext', () => {
      const result = FileTreeNodeSchema.safeParse(makeMount({ ext: 'txt' }))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.path.includes('ext'))).toBe(true)
    })

    it('rejects mount with non-null remoteId', () => {
      const result = FileTreeNodeSchema.safeParse(makeMount({ remoteId: 'file-123' }))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.path.includes('remoteId'))).toBe(true)
    })

    it('rejects mount with non-null cachedAt', () => {
      const result = FileTreeNodeSchema.safeParse(makeMount({ cachedAt: TS }))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.path.includes('cachedAt'))).toBe(true)
    })
  })

  describe('dir', () => {
    it('accepts a valid dir node', () => {
      expect(FileTreeNodeSchema.safeParse(makeDir()).success).toBe(true)
    })

    it('rejects dir with null parentId', () => {
      const result = FileTreeNodeSchema.safeParse(makeDir({ parentId: null }))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.path.includes('parentId'))).toBe(true)
    })

    it('rejects dir with non-null providerConfig', () => {
      const result = FileTreeNodeSchema.safeParse(
        makeDir({ providerConfig: { providerType: 'local_managed', basePath: '/x' } })
      )
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.path.includes('providerConfig'))).toBe(true)
    })

    it('accepts dir with remoteId (remote directories have IDs)', () => {
      const result = FileTreeNodeSchema.safeParse(makeDir({ remoteId: 'folder-123' }))
      expect(result.success).toBe(true)
    })

    it('accepts dir with cachedAt (remote directories have cache state)', () => {
      const result = FileTreeNodeSchema.safeParse(makeDir({ cachedAt: TS }))
      expect(result.success).toBe(true)
    })
  })

  describe('file', () => {
    it('accepts a valid file node', () => {
      expect(FileTreeNodeSchema.safeParse(makeFile()).success).toBe(true)
    })

    it('rejects file with null parentId', () => {
      const result = FileTreeNodeSchema.safeParse(makeFile({ parentId: null }))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.path.includes('parentId'))).toBe(true)
    })

    it('rejects file with non-null providerConfig', () => {
      const result = FileTreeNodeSchema.safeParse(
        makeFile({ providerConfig: { providerType: 'local_managed', basePath: '/x' } })
      )
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.path.includes('providerConfig'))).toBe(true)
    })
  })
})

describe('FileTreeNodeSchema trash invariants', () => {
  it('accepts valid trashed node (parentId=system_trash + previousParentId set)', () => {
    const result = FileTreeNodeSchema.safeParse(
      makeFile({ parentId: 'system_trash', previousParentId: VALID_UUID_V7_2 })
    )
    expect(result.success).toBe(true)
  })

  it('accepts valid active node (no previousParentId)', () => {
    const result = FileTreeNodeSchema.safeParse(makeFile({ previousParentId: null }))
    expect(result.success).toBe(true)
  })

  it('rejects trashed node without previousParentId', () => {
    const result = FileTreeNodeSchema.safeParse(makeFile({ parentId: 'system_trash', previousParentId: null }))
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((i) => i.path.includes('previousParentId'))).toBe(true)
  })

  it('rejects previousParentId set on non-trashed node', () => {
    const result = FileTreeNodeSchema.safeParse(makeFile({ previousParentId: VALID_UUID_V7_2 }))
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((i) => i.path.includes('previousParentId'))).toBe(true)
  })
})

describe('NodeIdSchema', () => {
  it('accepts UUID v7', () => {
    expect(NodeIdSchema.safeParse('019606a0-0000-7000-8000-000000000001').success).toBe(true)
  })

  it('accepts system node IDs', () => {
    expect(NodeIdSchema.safeParse('mount_files').success).toBe(true)
    expect(NodeIdSchema.safeParse('mount_notes').success).toBe(true)
    expect(NodeIdSchema.safeParse('system_trash').success).toBe(true)
  })

  it('rejects UUID v4', () => {
    expect(NodeIdSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(false)
  })

  it('rejects random strings', () => {
    expect(NodeIdSchema.safeParse('not-a-valid-id').success).toBe(false)
    expect(NodeIdSchema.safeParse('').success).toBe(false)
  })

  it('accepts mount_temp', () => {
    expect(NodeIdSchema.safeParse('mount_temp').success).toBe(true)
  })
})

describe('MountProviderConfigSchema', () => {
  describe('local_managed', () => {
    it('accepts valid config', () => {
      expect(
        LocalManagedConfigSchema.safeParse({ providerType: 'local_managed', basePath: '/data/files' }).success
      ).toBe(true)
    })

    it('rejects relative basePath', () => {
      expect(
        LocalManagedConfigSchema.safeParse({ providerType: 'local_managed', basePath: 'relative/path' }).success
      ).toBe(false)
    })

    it('rejects empty basePath', () => {
      expect(LocalManagedConfigSchema.safeParse({ providerType: 'local_managed', basePath: '' }).success).toBe(false)
    })
  })

  describe('local_external', () => {
    it('accepts valid config', () => {
      const result = LocalExternalConfigSchema.safeParse({
        providerType: 'local_external',
        basePath: '/home/user/notes',
        watch: true
      })
      expect(result.success).toBe(true)
    })

    it('accepts Windows path', () => {
      expect(
        LocalExternalConfigSchema.safeParse({
          providerType: 'local_external',
          basePath: 'C:\\Users\\notes',
          watch: false
        }).success
      ).toBe(true)
    })

    it('defaults watchExtensions to empty array', () => {
      const result = LocalExternalConfigSchema.safeParse({
        providerType: 'local_external',
        basePath: '/notes'
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.watchExtensions).toEqual([])
      }
    })

    it('rejects relative basePath', () => {
      expect(
        LocalExternalConfigSchema.safeParse({
          providerType: 'local_external',
          basePath: 'notes'
        }).success
      ).toBe(false)
    })
  })

  describe('remote', () => {
    it('accepts valid config', () => {
      expect(
        RemoteConfigSchema.safeParse({
          providerType: 'remote',
          apiType: 'openai_files',
          providerId: 'provider-1',
          autoSync: false,
          options: {}
        }).success
      ).toBe(true)
    })

    it('rejects invalid apiType', () => {
      expect(
        RemoteConfigSchema.safeParse({
          providerType: 'remote',
          apiType: 'invalid_type',
          providerId: 'p1'
        }).success
      ).toBe(false)
    })
  })

  describe('system', () => {
    it('accepts valid config', () => {
      expect(SystemConfigSchema.safeParse({ providerType: 'system' }).success).toBe(true)
    })
  })

  describe('discriminated union', () => {
    it('discriminates by providerType', () => {
      expect(MountProviderConfigSchema.safeParse({ providerType: 'local_managed', basePath: '/x' }).success).toBe(true)
      expect(MountProviderConfigSchema.safeParse({ providerType: 'system' }).success).toBe(true)
    })

    it('rejects unknown providerType', () => {
      expect(MountProviderConfigSchema.safeParse({ providerType: 'unknown' }).success).toBe(false)
    })

    it('rejects config missing required fields', () => {
      expect(MountProviderConfigSchema.safeParse({ providerType: 'local_managed' }).success).toBe(false)
    })
  })
})

describe('CreateNodeDtoSchema', () => {
  it('rejects type=mount', () => {
    const result = CreateNodeDtoSchema.safeParse({
      type: 'mount',
      name: 'evil-mount',
      parentId: '019606a0-0000-7000-8000-000000000001'
    })
    expect(result.success).toBe(false)
  })
})
