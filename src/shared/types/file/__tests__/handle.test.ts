import { describe, expect, it } from 'vitest'

import type { FilePath } from '../common'
import { createFileEntryHandle, createFilePathHandle, isFileEntryHandle, isFilePathHandle } from '../handle'

describe('createFileEntryHandle', () => {
  it('wraps the entryId verbatim', () => {
    const h = createFileEntryHandle('019606a0-0000-7000-8000-000000000001')
    expect(h).toEqual({ kind: 'entry', entryId: '019606a0-0000-7000-8000-000000000001' })
  })
})

describe('createFilePathHandle — runtime validation', () => {
  it('accepts POSIX absolute paths', () => {
    const h = createFilePathHandle('/Users/me/doc.pdf')
    expect(h).toEqual({ kind: 'path', path: '/Users/me/doc.pdf' })
  })

  it('accepts Windows absolute paths', () => {
    const h = createFilePathHandle('C:\\Users\\me\\doc.pdf' as FilePath)
    expect(h.kind).toBe('path')
    expect(h.path).toBe('C:\\Users\\me\\doc.pdf')
  })

  it('rejects empty string', () => {
    expect(() => createFilePathHandle('' as FilePath)).toThrow(TypeError)
  })

  it('rejects non-string input', () => {
    expect(() => createFilePathHandle(123 as unknown as FilePath)).toThrow(TypeError)
  })

  it('rejects relative paths', () => {
    expect(() => createFilePathHandle('./doc.pdf' as FilePath)).toThrow(TypeError)
    expect(() => createFilePathHandle('doc.pdf' as FilePath)).toThrow(TypeError)
    expect(() => createFilePathHandle('../doc.pdf' as FilePath)).toThrow(TypeError)
  })

  it('rejects file:// URLs (use FileURLString instead)', () => {
    expect(() => createFilePathHandle('file:///Users/me/doc.pdf' as FilePath)).toThrow(TypeError)
  })
})

describe('handle type guards', () => {
  it('isFileEntryHandle narrows to the entry variant', () => {
    const h = createFileEntryHandle('019606a0-0000-7000-8000-000000000001')
    expect(isFileEntryHandle(h)).toBe(true)
    expect(isFilePathHandle(h)).toBe(false)
  })

  it('isFilePathHandle narrows to the path variant', () => {
    const h = createFilePathHandle('/tmp/x')
    expect(isFilePathHandle(h)).toBe(true)
    expect(isFileEntryHandle(h)).toBe(false)
  })
})
