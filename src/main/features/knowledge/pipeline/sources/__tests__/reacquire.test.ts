import { describe, expect, it, vi } from 'vitest'

const { copyMock, getByIdMock } = vi.hoisted(() => ({ copyMock: vi.fn(), getByIdMock: vi.fn() }))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: { getById: getByIdMock }
}))
vi.mock('../../../pathStorage', () => ({
  copyFileIntoKnowledgeBaseAt: copyMock,
  writeFileIntoKnowledgeBaseAt: vi.fn()
}))

import type { IndexableKnowledgeItem } from '../../../items'

const { resolveKnowledgeReacquireProducer } = await import('../reacquire')

describe('resolveKnowledgeReacquireProducer file writes', () => {
  it('binds the destination to the item row when the write runs, not when prepared', async () => {
    // Preparation runs before reindex takes the base lock; a rename that wins the lock changes
    // relativePath. The write must target the activated row's current path, not the captured one.
    const item = {
      id: 'item-1',
      baseId: 'base-1',
      type: 'file',
      data: { source: '/home/me/paper.pdf', relativePath: 'paper.pdf' }
    } as unknown as IndexableKnowledgeItem
    getByIdMock.mockReturnValue({ data: { relativePath: 'renamed.pdf' } })

    const producer = resolveKnowledgeReacquireProducer(item)
    expect(producer).not.toBeNull()
    const write = await producer!(new AbortController().signal)
    await write(new AbortController().signal)

    expect(copyMock).toHaveBeenCalledWith('base-1', '/home/me/paper.pdf', 'renamed.pdf', {
      overwrite: true,
      signal: expect.any(AbortSignal)
    })
  })

  it('falls back to the captured path when the row no longer carries one', async () => {
    const item = {
      id: 'item-1',
      baseId: 'base-1',
      type: 'file',
      data: { source: '/home/me/paper.pdf', relativePath: 'paper.pdf' }
    } as unknown as IndexableKnowledgeItem
    getByIdMock.mockReturnValue({ data: {} })

    const write = await resolveKnowledgeReacquireProducer(item)!(new AbortController().signal)
    await write(new AbortController().signal)

    expect(copyMock).toHaveBeenCalledWith('base-1', '/home/me/paper.pdf', 'paper.pdf', {
      overwrite: true,
      signal: expect.any(AbortSignal)
    })
  })
})
