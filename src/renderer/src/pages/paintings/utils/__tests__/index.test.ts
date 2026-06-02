import { describe, expect, it } from 'vitest'

import { findPaintingByFiles, getNewApiSeedPainting } from '../index'

describe('findPaintingByFiles', () => {
  const createPainting = (id: string, providerId: string, fileIds: string[]) => ({
    id,
    providerId,
    files: fileIds.map((fileId) => ({ id: fileId }))
  })

  it('returns a painting with the same provider and file order', () => {
    const paintings = [
      createPainting('1', 'provider-a', ['file-1', 'file-2']),
      createPainting('2', 'provider-a', ['file-3'])
    ]

    expect(findPaintingByFiles(paintings, 'provider-a', [{ id: 'file-1' }, { id: 'file-2' }])).toMatchObject({
      id: '1'
    })
  })

  it('ignores paintings from other providers or different file sequences', () => {
    const paintings = [
      createPainting('1', 'provider-b', ['file-1', 'file-2']),
      createPainting('2', 'provider-a', ['file-2', 'file-1'])
    ]

    expect(findPaintingByFiles(paintings, 'provider-a', [{ id: 'file-1' }, { id: 'file-2' }])).toBeUndefined()
  })
})

describe('getNewApiSeedPainting', () => {
  const createPainting = (id: string, providerId: string) => ({
    id,
    providerId,
    urls: [],
    files: [],
    model: '',
    prompt: ''
  })

  it('keeps the current provider draft so first updates target the seeded painting', () => {
    const currentPainting = createPainting('draft-id', 'provider-a')

    const seedPainting = getNewApiSeedPainting(currentPainting, 'provider-a', (basePainting) => ({
      ...createPainting('new-id', 'provider-a'),
      ...basePainting,
      model: basePainting?.model || 'gpt-image-1'
    }))

    expect(seedPainting).toMatchObject({
      id: 'draft-id',
      model: 'gpt-image-1',
      providerId: 'provider-a'
    })
  })

  it('creates a fresh seed when the current draft belongs to another provider', () => {
    const currentPainting = createPainting('other-provider-draft-id', 'provider-b')

    const seedPainting = getNewApiSeedPainting(currentPainting, 'provider-a', (basePainting) => ({
      ...createPainting('new-id', 'provider-a'),
      ...basePainting,
      model: basePainting?.model || 'gpt-image-1'
    }))

    expect(seedPainting).toMatchObject({
      id: 'new-id',
      providerId: 'provider-a'
    })
  })
})
