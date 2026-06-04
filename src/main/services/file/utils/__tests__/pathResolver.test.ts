import { describe, expect, it, vi } from 'vitest'

// Route `@application` through the unified mock factory so `application.getPath`
// follows the project-wide stub (`/mock/<key>[/<filename>]`) and stays in sync
// with any future changes in tests/__mocks__/main/application.ts.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import type { FilePath } from '@shared/file/types'

import type { PathResolvableEntry } from '../pathResolver'
import { getExtSuffix, resolvePhysicalPath } from '../pathResolver'

describe('getExtSuffix', () => {
  it('returns dot-prefixed extension for non-null ext', () => {
    expect(getExtSuffix('pdf')).toBe('.pdf')
    expect(getExtSuffix('md')).toBe('.md')
  })

  it('returns empty string for null ext', () => {
    expect(getExtSuffix(null)).toBe('')
  })
})

describe('resolvePhysicalPath', () => {
  describe('origin=internal', () => {
    it('returns {userData}/feature.files.data/{id}.{ext}', () => {
      const entry: PathResolvableEntry = {
        id: 'abc-123',
        origin: 'internal',
        ext: 'pdf'
      }
      expect(resolvePhysicalPath(entry)).toBe('/mock/feature.files.data/abc-123.pdf')
    })

    it('returns path with bare id when ext is null', () => {
      const entry: PathResolvableEntry = {
        id: 'abc-123',
        origin: 'internal',
        ext: null
      }
      expect(resolvePhysicalPath(entry)).toBe('/mock/feature.files.data/abc-123')
    })
  })

  describe('origin=external', () => {
    it('returns externalPath directly', () => {
      const entry: PathResolvableEntry = {
        id: '019606a0-0000-7000-8000-000000000001',
        origin: 'external',
        ext: 'md',
        externalPath: '/Users/me/notes/readme.md' as FilePath
      }
      expect(resolvePhysicalPath(entry)).toBe('/Users/me/notes/readme.md')
    })
  })

  describe('security', () => {
    it('rejects null bytes in entry.id', () => {
      const entry: PathResolvableEntry = {
        id: 'abc\0evil',
        origin: 'internal',
        ext: 'txt'
      }
      expect(() => resolvePhysicalPath(entry)).toThrow('null bytes')
    })

    it('rejects null bytes in entry.ext', () => {
      const entry: PathResolvableEntry = {
        id: 'abc-123',
        origin: 'internal',
        ext: 'txt\0evil'
      }
      expect(() => resolvePhysicalPath(entry)).toThrow('null bytes')
    })

    // Null-byte rejection for externalPath is enforced upstream at the
    // FilePathSchema layer (refine: no null bytes) — covered by the schema
    // spec at src/shared/file/types/__tests__/FilePathSchema.test.ts.
    // resolvePhysicalPath's external branch trusts the brand and returns
    // entry.externalPath directly with no further check.
  })
})
