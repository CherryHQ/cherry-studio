/**
 * Schema-layer tests for FilePathSchema. The orthogonal algorithm-layer tests
 * for canonicalizeAbsolutePath live in packages/shared/file/__tests__/canonicalize.test.ts.
 *
 * This file verifies refine guards, transform composition, brand idempotency,
 * and type inference at the schema surface — without re-testing algorithm
 * details that the lower layer already covers end-to-end.
 */

import { describe, expect, expectTypeOf, it } from 'vitest'

import { type FilePath, FilePathSchema } from '../common'

describe('FilePathSchema', () => {
  describe('refine: null byte', () => {
    it('rejects strings containing \\0', () => {
      const result = FilePathSchema.safeParse('/foo/bar\0/baz')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes('null byte'))).toBe(true)
      }
    })
  })

  describe('refine: min length', () => {
    it('rejects the empty string', () => {
      expect(FilePathSchema.safeParse('').success).toBe(false)
    })
  })

  describe('refine: absolute', () => {
    it('rejects relative POSIX path', () => {
      expect(FilePathSchema.safeParse('foo/bar').success).toBe(false)
    })

    it('rejects relative Windows path', () => {
      expect(FilePathSchema.safeParse('Foo\\Bar').success).toBe(false)
    })

    it('rejects file:// URLs', () => {
      expect(FilePathSchema.safeParse('file:///foo/bar').success).toBe(false)
    })

    it('rejects drive-relative Windows path (no separator after drive)', () => {
      expect(FilePathSchema.safeParse('C:foo').success).toBe(false)
    })

    it('accepts POSIX absolute /foo/bar', () => {
      expect(FilePathSchema.safeParse('/foo/bar').success).toBe(true)
    })

    it('accepts Windows backslash C:\\foo', () => {
      expect(FilePathSchema.safeParse('C:\\foo').success).toBe(true)
    })

    it('accepts Windows forward slash C:/foo', () => {
      expect(FilePathSchema.safeParse('C:/foo').success).toBe(true)
    })
  })

  describe('transform: canonicalize', () => {
    it('NFD input is normalized to NFC', () => {
      const nfd = '/foo/café' // 'e' + combining acute accent (NFD)
      const nfc = '/foo/café' // precomposed é (NFC)
      expect(FilePathSchema.parse(nfd)).toBe(nfc)
    })

    it('strips trailing separator', () => {
      expect(FilePathSchema.parse('/foo/bar/')).toBe('/foo/bar')
    })

    it('resolves ./ and ../', () => {
      expect(FilePathSchema.parse('/foo/./bar/../baz')).toBe('/foo/baz')
    })

    it('uppercases Windows drive letter', () => {
      expect(FilePathSchema.parse('c:\\Foo')).toBe('C:\\Foo')
    })
  })

  describe('brand: idempotency', () => {
    it('parsing canonical input is a no-op', () => {
      const canonical = '/foo/bar'
      expect(FilePathSchema.parse(canonical)).toBe(canonical)
    })

    it('parsing an already-branded FilePath value succeeds', () => {
      const first = FilePathSchema.parse('/foo/./bar')
      const second = FilePathSchema.parse(first)
      expect(second).toBe(first)
    })
  })

  describe('type inference', () => {
    it('output is FilePath, not plain string', () => {
      const value = FilePathSchema.parse('/foo')
      expectTypeOf(value).toEqualTypeOf<FilePath>()
      // Compile-time guard: a plain string is NOT assignable to FilePath.
      // @ts-expect-error - raw string lacks the FilePath brand
      const _no: FilePath = '/foo'
      void _no
    })
  })
})
