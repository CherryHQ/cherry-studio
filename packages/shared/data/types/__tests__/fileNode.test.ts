import { describe, expect, it } from 'vitest'

import { CreateNodeDtoSchema, FileNodeSchema, UpdateNodeDtoSchema } from '../fileNode'

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
    isReadonly: false,
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
    ext: 'txt',
    parentId: '019606a0-0000-7000-8000-000000000002',
    mountId: '019606a0-0000-7000-8000-000000000003'
  }
}

describe('SafeNameSchema validation', () => {
  describe('FileNodeSchema.name', () => {
    it('accepts a normal filename', () => {
      const result = FileNodeSchema.safeParse(makeFileNode('my-document'))
      expect(result.success).toBe(true)
    })

    it('accepts filenames with spaces and unicode', () => {
      const result = FileNodeSchema.safeParse(makeFileNode('我的文档 (copy)'))
      expect(result.success).toBe(true)
    })

    it('accepts filenames with dots (not traversal)', () => {
      const result = FileNodeSchema.safeParse(makeFileNode('file.backup.old'))
      expect(result.success).toBe(true)
    })

    it('accepts triple-dot filename', () => {
      const result = FileNodeSchema.safeParse(makeFileNode('...'))
      expect(result.success).toBe(true)
    })

    it('rejects empty name', () => {
      const result = FileNodeSchema.safeParse(makeFileNode(''))
      expect(result.success).toBe(false)
    })

    it('rejects name exceeding 255 characters', () => {
      const result = FileNodeSchema.safeParse(makeFileNode('a'.repeat(256)))
      expect(result.success).toBe(false)
    })

    it('accepts name at exactly 255 characters', () => {
      const result = FileNodeSchema.safeParse(makeFileNode('a'.repeat(255)))
      expect(result.success).toBe(true)
    })

    it('rejects name containing null byte', () => {
      const result = FileNodeSchema.safeParse(makeFileNode('file\0evil'))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.message.includes('null bytes'))).toBe(true)
    })

    it('rejects name containing forward slash', () => {
      const result = FileNodeSchema.safeParse(makeFileNode('path/to/file'))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.message.includes('path separators'))).toBe(true)
    })

    it('rejects name containing backslash', () => {
      const result = FileNodeSchema.safeParse(makeFileNode('path\\to\\file'))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.message.includes('path separators'))).toBe(true)
    })

    it('rejects name that is single dot', () => {
      const result = FileNodeSchema.safeParse(makeFileNode('.'))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.message.includes('. or ..'))).toBe(true)
    })

    it('rejects name that is double dot', () => {
      const result = FileNodeSchema.safeParse(makeFileNode('..'))
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((i) => i.message.includes('. or ..'))).toBe(true)
    })

    it('rejects traversal sequence ../../etc/passwd', () => {
      const result = FileNodeSchema.safeParse(makeFileNode('../../etc/passwd'))
      expect(result.success).toBe(false)
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
