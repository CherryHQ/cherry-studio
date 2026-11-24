import { describe, expect, it } from 'vitest'

import {
  blobRefsOf,
  envelopeDisplayExcerpt,
  isPersistedToolOutput,
  type PersistedToolOutputEntitiesRef,
  type PersistedToolOutputSingleRef
} from '../persistedToolOutput'

const singleRef: PersistedToolOutputSingleRef = {
  fileEntryId: 'entry-1',
  vfsFilename: 'vfs_0123456789abcdef.txt',
  head: 'first lines',
  tail: 'last lines',
  totalChars: 200_000,
  totalLines: 5_000,
  shape: 'text'
}

const blob = (key: string, n: number) => ({
  key,
  fileEntryId: `entry-${n}`,
  vfsFilename: `vfs_${n}.txt`,
  head: `head-${n}`,
  tail: `tail-${n}`,
  totalChars: 1000 * n,
  totalLines: 10 * n
})

const entitiesRef: PersistedToolOutputEntitiesRef = {
  shape: 'entities',
  skeleton: [{ id: 'cite-0', content: 'snippet…' }],
  blobRefs: [blob('/0/content', 1), blob('/1/content', 2)]
}

describe('isPersistedToolOutput', () => {
  it.each([
    ['v1 text', { $persistedToolOutput: singleRef }],
    ['v1 mcp-content', { $persistedToolOutput: { ...singleRef, shape: 'mcp-content', metadata: { serverId: 's' } } }],
    ['v2 entities', { $persistedToolOutput: entitiesRef }],
    ['v2 opaque undefined skeleton', { $persistedToolOutput: { ...entitiesRef, skeleton: undefined } }]
  ])('accepts %s envelopes', (_label, value) => {
    expect(isPersistedToolOutput(value)).toBe(true)
  })

  it.each([
    ['plain object without the sentinel key', { content: 'x' }],
    ['incomplete reference', { $persistedToolOutput: {} }],
    ['array reference', { $persistedToolOutput: [] }],
    ['unknown shape', { $persistedToolOutput: { ...singleRef, shape: 'future' } }],
    ['invalid excerpt', { $persistedToolOutput: { ...singleRef, head: 42 } }],
    ['invalid blob', { $persistedToolOutput: { ...entitiesRef, blobRefs: [{ key: '/text' }] } }],
    ['empty entity blobs', { $persistedToolOutput: { ...entitiesRef, blobRefs: [] } }],
    ['missing entity skeleton', { $persistedToolOutput: { shape: 'entities', blobRefs: entitiesRef.blobRefs } }],
    ['null ref', { $persistedToolOutput: null }],
    ['string', 'plain output'],
    ['null', null]
  ])('rejects %s', (_label, value) => {
    expect(isPersistedToolOutput(value)).toBe(false)
  })

  it('accepts opaque metadata and unknown sibling fields', () => {
    const metadata = { nested: { owner: 'opaque' } }
    const value = { $persistedToolOutput: { ...singleRef, shape: 'mcp-content', metadata }, extra: Symbol('opaque') }

    expect(isPersistedToolOutput(value)).toBe(true)
  })

  it('does not interpret unrelated extension properties', () => {
    const value = Object.defineProperty({ $persistedToolOutput: singleRef }, 'extra', {
      enumerable: true,
      get() {
        throw new Error('opaque extension')
      }
    })

    expect(isPersistedToolOutput(value)).toBe(true)
  })

  it('rejects an unreadable marker without replacing the original tool failure', () => {
    const value = Object.defineProperty({}, '$persistedToolOutput', {
      get() {
        throw new Error('unreadable marker')
      }
    })

    expect(isPersistedToolOutput(value)).toBe(false)
  })
})

describe('blobRefsOf', () => {
  it('views a single-blob envelope as one whole-output blob', () => {
    expect(blobRefsOf(singleRef)).toEqual([
      {
        key: '',
        fileEntryId: 'entry-1',
        vfsFilename: 'vfs_0123456789abcdef.txt',
        head: 'first lines',
        tail: 'last lines',
        totalChars: 200_000,
        totalLines: 5_000
      }
    ])
  })

  it('returns the entities blobs as-is', () => {
    expect(blobRefsOf(entitiesRef)).toEqual(entitiesRef.blobRefs)
  })
})

describe('envelopeDisplayExcerpt', () => {
  it('mirrors the single-blob excerpt fields', () => {
    expect(envelopeDisplayExcerpt(singleRef)).toEqual({
      head: 'first lines',
      tail: 'last lines',
      totalChars: 200_000,
      totalLines: 5_000
    })
  })

  it('spans first head to last tail with summed totals for entities', () => {
    expect(envelopeDisplayExcerpt(entitiesRef)).toEqual({
      head: 'head-1',
      tail: 'tail-2',
      totalChars: 3000,
      totalLines: 30
    })
  })
})
