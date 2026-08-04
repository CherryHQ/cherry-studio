import { describe, expect, it } from 'vitest'

import { getExtSuffix, toInternalBlobFileName } from '../blobName'

describe('getExtSuffix', () => {
  it('returns dot-prefixed extension for non-null ext', () => {
    expect(getExtSuffix('pdf')).toBe('.pdf')
    expect(getExtSuffix('md')).toBe('.md')
  })

  it('returns empty string for null ext', () => {
    expect(getExtSuffix(null)).toBe('')
  })
})

describe('toInternalBlobFileName', () => {
  it('projects the FileManager flat-storage filename', () => {
    expect(toInternalBlobFileName({ id: 'abc-123', ext: 'pdf' })).toBe('abc-123.pdf')
    expect(toInternalBlobFileName({ id: 'abc-123', ext: null })).toBe('abc-123')
  })
})
