import { describe, expect, it } from 'vitest'

import { toInternalBlobFileName } from '../portableProfilePolicy'

describe('toInternalBlobFileName', () => {
  it('projects the FileManager flat-storage filename', () => {
    expect(toInternalBlobFileName({ id: 'abc-123', ext: 'pdf' })).toBe('abc-123.pdf')
    expect(toInternalBlobFileName({ id: 'abc-123', ext: null })).toBe('abc-123')
  })
})
