import { describe, expect, it } from 'vitest'

import { isPastedTextFileReference } from '../file'

describe('pasted-text file references', () => {
  it('accepts the tag and read path without requiring unrelated legacy metadata', () => {
    expect(isPastedTextFileReference({ composerFileKind: 'pasted-text', path: '/tmp/pasted.txt' })).toBe(true)
  })

  it('accepts the optional token identity used when removing the pasted attachment', () => {
    expect(
      isPastedTextFileReference({
        composerFileKind: 'pasted-text',
        path: '/tmp/pasted.txt',
        fileTokenSourceId: 'source-1'
      })
    ).toBe(true)
  })

  it.each([
    null,
    {},
    { composerFileKind: 'pasted-text' },
    { composerFileKind: 'pasted-text', path: 42 },
    { composerFileKind: 'pasted-text', path: '/tmp/pasted.txt', fileTokenSourceId: 42 }
  ])('rejects payloads that cannot supply a pasted-text read path: %j', (value) => {
    expect(isPastedTextFileReference(value)).toBe(false)
  })
})
