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
  // The v1 arm is frozen: shipped rows must keep validating forever.
  it.each([
    ['v1 text', { $persistedToolOutput: singleRef }],
    ['v1 mcp-content', { $persistedToolOutput: { ...singleRef, shape: 'mcp-content', metadata: { serverId: 's' } } }],
    ['v2 entities', { $persistedToolOutput: entitiesRef }]
  ])('accepts %s envelopes', (_label, value) => {
    expect(isPersistedToolOutput(value)).toBe(true)
  })

  it.each([
    ['plain object', { content: 'x' }],
    ['null ref', { $persistedToolOutput: null }],
    ['v1 with missing entry id', { $persistedToolOutput: { ...singleRef, fileEntryId: '' } }],
    ['v1 with unknown shape', { $persistedToolOutput: { ...singleRef, shape: 'zip' } }],
    ['entities without blobs', { $persistedToolOutput: { shape: 'entities', skeleton: [], blobRefs: [] } }],
    ['entities without skeleton', { $persistedToolOutput: { shape: 'entities', blobRefs: [blob('/0/content', 1)] } }],
    [
      'entities with a malformed blob',
      { $persistedToolOutput: { shape: 'entities', skeleton: [], blobRefs: [{ key: '/0/content' }] } }
    ]
  ])('rejects %s', (_label, value) => {
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
    expect(blobRefsOf(entitiesRef)).toBe(entitiesRef.blobRefs)
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
