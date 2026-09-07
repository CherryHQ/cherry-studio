import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { fileHandleFromPart } from '../fileHandle'

function filePart(overrides: Record<string, unknown>): CherryMessagePart {
  return {
    type: 'file',
    mediaType: 'text/markdown',
    filename: 'note.md',
    ...overrides
  } as unknown as CherryMessagePart
}

describe('fileHandleFromPart', () => {
  it('prefers the recorded entry id over the stored URL', () => {
    const part = filePart({
      url: 'file:///tmp/note.md',
      providerMetadata: { cherry: { fileEntryId: '01a066b1-2d81-76ca-a828-018c02068f88' } }
    })

    expect(fileHandleFromPart(part)).toEqual({ kind: 'entry', entryId: '01a066b1-2d81-76ca-a828-018c02068f88' })
  })

  // The defect this whole indirection exists for: a scheme strip leaves "%20" in a
  // value that reaches fs.open, which then reports ENOENT on a file that is there.
  it('decodes a percent-encoded URL when the part is addressed by path', () => {
    const part = filePart({ url: 'file:///Users/a/Application%20Support/note.md' })

    expect(fileHandleFromPart(part)).toEqual({ kind: 'path', path: '/Users/a/Application Support/note.md' })
  })

  it('returns undefined rather than a broken handle for unusable parts', () => {
    expect(fileHandleFromPart(filePart({}))).toBeUndefined()
    expect(fileHandleFromPart(filePart({ url: 'https://example.com/note.md' }))).toBeUndefined()
    expect(fileHandleFromPart({ type: 'text', text: 'hi' } as CherryMessagePart)).toBeUndefined()
  })
})
