import { describe, expect, it } from 'vitest'

import type { FilePath } from '../common'
import { createManagedHandle, createUnmanagedHandle, isManagedHandle, isUnmanagedHandle } from '../handle'

describe('createManagedHandle', () => {
  it('wraps the entryId verbatim', () => {
    const h = createManagedHandle('019606a0-0000-7000-8000-000000000001')
    expect(h).toEqual({ kind: 'managed', entryId: '019606a0-0000-7000-8000-000000000001' })
  })
})

describe('createUnmanagedHandle — runtime validation', () => {
  it('accepts POSIX absolute paths', () => {
    const h = createUnmanagedHandle('/Users/me/doc.pdf')
    expect(h).toEqual({ kind: 'unmanaged', path: '/Users/me/doc.pdf' })
  })

  it('accepts Windows absolute paths', () => {
    const h = createUnmanagedHandle('C:\\Users\\me\\doc.pdf' as FilePath)
    expect(h.kind).toBe('unmanaged')
    expect(h.path).toBe('C:\\Users\\me\\doc.pdf')
  })

  it('rejects empty string', () => {
    expect(() => createUnmanagedHandle('' as FilePath)).toThrow(TypeError)
  })

  it('rejects non-string input', () => {
    expect(() => createUnmanagedHandle(123 as unknown as FilePath)).toThrow(TypeError)
  })

  it('rejects relative paths', () => {
    expect(() => createUnmanagedHandle('./doc.pdf' as FilePath)).toThrow(TypeError)
    expect(() => createUnmanagedHandle('doc.pdf' as FilePath)).toThrow(TypeError)
    expect(() => createUnmanagedHandle('../doc.pdf' as FilePath)).toThrow(TypeError)
  })

  it('rejects file:// URLs (use FileURLString instead)', () => {
    expect(() => createUnmanagedHandle('file:///Users/me/doc.pdf' as FilePath)).toThrow(TypeError)
  })
})

describe('handle type guards', () => {
  it('isManagedHandle narrows to managed', () => {
    const h = createManagedHandle('019606a0-0000-7000-8000-000000000001')
    expect(isManagedHandle(h)).toBe(true)
    expect(isUnmanagedHandle(h)).toBe(false)
  })

  it('isUnmanagedHandle narrows to unmanaged', () => {
    const h = createUnmanagedHandle('/tmp/x')
    expect(isUnmanagedHandle(h)).toBe(true)
    expect(isManagedHandle(h)).toBe(false)
  })
})
