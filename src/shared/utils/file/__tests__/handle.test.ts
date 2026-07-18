import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { describe, expect, it } from 'vitest'

import { createFileEntryHandle, createFilePathHandle, isFileEntryHandle, isFilePathHandle } from '../handle'

describe('createFileEntryHandle', () => {
  it('wraps the entryId verbatim', () => {
    const h = createFileEntryHandle('019606a0-0000-7000-8000-000000000001')
    expect(h).toEqual({ kind: 'entry', entryId: '019606a0-0000-7000-8000-000000000001' })
  })
})

describe('createFilePathHandle — trusts the AbsoluteFilePath brand', () => {
  it('wraps a POSIX absolute path verbatim', () => {
    const h = createFilePathHandle('/Users/me/doc.pdf' as AbsoluteFilePath)
    expect(h).toEqual({ kind: 'path', path: '/Users/me/doc.pdf' })
  })

  it('wraps a Windows backslash absolute path verbatim', () => {
    const h = createFilePathHandle('C:\\Users\\me\\doc.pdf' as AbsoluteFilePath)
    expect(h).toEqual({ kind: 'path', path: 'C:\\Users\\me\\doc.pdf' })
  })

  it('wraps a Windows forward-slash path the schema accepts (no separator re-check)', () => {
    // Regression for the old hand-rolled `^[A-Za-z]:\\` check that rejected the
    // `C:/` form AbsoluteFilePathSchema accepts. Feed a real branded value (not a
    // forged cast) to prove the round-trip: schema in, handle out, no throw.
    const path = AbsoluteFilePathSchema.parse('C:/Users/me/doc.pdf')
    expect(createFilePathHandle(path)).toEqual({ kind: 'path', path: 'C:/Users/me/doc.pdf' })
  })
})

describe('handle type guards', () => {
  it('isFileEntryHandle narrows to the entry variant', () => {
    const h = createFileEntryHandle('019606a0-0000-7000-8000-000000000001')
    expect(isFileEntryHandle(h)).toBe(true)
    expect(isFilePathHandle(h)).toBe(false)
  })

  it('isFilePathHandle narrows to the path variant', () => {
    const h = createFilePathHandle('/tmp/x' as AbsoluteFilePath)
    expect(isFilePathHandle(h)).toBe(true)
    expect(isFileEntryHandle(h)).toBe(false)
  })
})
