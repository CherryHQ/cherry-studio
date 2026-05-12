import { describe, expect, it, vi } from 'vitest'

// Route `@application` through the unified mock factory so `application.getPath`
// follows the project-wide stub (`/mock/<key>[/<filename>]`) and stays in sync
// with any future changes in tests/__mocks__/main/application.ts.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import path from 'node:path'

import type { CanonicalExternalPath } from '@shared/data/types/file'

import type { PathResolvableEntry } from '../pathResolver'
import { canonicalizeExternalPath, getExtSuffix, resolvePhysicalPath } from '../pathResolver'

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
        externalPath: '/Users/me/notes/readme.md'
      }
      expect(resolvePhysicalPath(entry)).toBe('/Users/me/notes/readme.md')
    })

    it('resolves path (normalizes relative segments)', () => {
      const entry: PathResolvableEntry = {
        id: '019606a0-0000-7000-8000-000000000002',
        origin: 'external',
        ext: 'pdf',
        externalPath: '/Users/me/./docs/../docs/report.pdf'
      }
      expect(resolvePhysicalPath(entry)).toBe('/Users/me/docs/report.pdf')
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

    it('rejects null bytes in externalPath', () => {
      const entry: PathResolvableEntry = {
        id: '019606a0-0000-7000-8000-000000000001',
        origin: 'external',
        ext: 'md',
        externalPath: '/Users/me/evil\0path.md'
      }
      expect(() => resolvePhysicalPath(entry)).toThrow('null bytes')
    })
  })
})

describe('canonicalizeExternalPath', () => {
  it('resolves "." and ".." segments', () => {
    const input = path.resolve('/foo/./bar/../baz')
    expect(canonicalizeExternalPath(input) as string).toBe(path.resolve('/foo/baz'))
  })

  it('NFC-normalizes Unicode (NFD → NFC)', () => {
    const nfd = '/users/Müller'
    const nfc = '/users/Müller'
    expect(canonicalizeExternalPath(nfd) as string).toBe(canonicalizeExternalPath(nfc) as string)
  })

  it('strips trailing path separator', () => {
    expect(canonicalizeExternalPath('/foo/bar/') as string).toBe(canonicalizeExternalPath('/foo/bar') as string)
  })

  it('preserves a path that is already canonical', () => {
    const canonical = path.resolve('/foo/bar/baz.txt')
    expect(canonicalizeExternalPath(canonical) as string).toBe(canonical)
  })

  it('rejects null bytes', () => {
    expect(() => canonicalizeExternalPath('/foo/bar\0/baz')).toThrow(/null byte/i)
  })

  it('returns a CanonicalExternalPath brand (compile-time check)', () => {
    const canonical: CanonicalExternalPath = canonicalizeExternalPath('/foo')
    expect(typeof canonical).toBe('string')
  })
})
