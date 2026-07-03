import { DataApiErrorFactory } from '@shared/data/api'
import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { knowledgeItemGetByIdMock, knowledgeItemGetSubtreeItemsMock } = vi.hoisted(() => ({
  knowledgeItemGetByIdMock: vi.fn(),
  knowledgeItemGetSubtreeItemsMock: vi.fn()
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: {
    getById: knowledgeItemGetByIdMock,
    getSubtreeItems: knowledgeItemGetSubtreeItemsMock
  }
}))

const { resolveLiveKnowledgeItem, resolveLiveKnowledgeSubtree } = await import('../liveItem')

function createItem(
  id: string,
  status: Exclude<KnowledgeItemOf<'note'>['status'], 'failed'> = 'processing'
): KnowledgeItemOf<'note'> {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'note',
    data: { source: 'note', content: 'text' },
    status,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

describe('resolveLiveKnowledgeItem', () => {
  beforeEach(() => {
    knowledgeItemGetByIdMock.mockReset()
  })

  it('returns the item when it is live', () => {
    const item = createItem('note-1')
    knowledgeItemGetByIdMock.mockReturnValue(item)

    expect(resolveLiveKnowledgeItem('note-1')).toEqual({ item })
  })

  it('classifies a deleting item as a deleting skip', () => {
    knowledgeItemGetByIdMock.mockReturnValue(createItem('note-1', 'deleting'))

    expect(resolveLiveKnowledgeItem('note-1')).toEqual({ skip: 'deleting' })
  })

  it('classifies a NOT_FOUND row as a missing skip', () => {
    knowledgeItemGetByIdMock.mockImplementation(() => {
      throw DataApiErrorFactory.notFound('KnowledgeItem', 'note-1')
    })

    expect(resolveLiveKnowledgeItem('note-1')).toEqual({ skip: 'missing' })
  })

  it('rethrows a non-NOT_FOUND error', () => {
    knowledgeItemGetByIdMock.mockImplementation(() => {
      throw new Error('db busy')
    })

    expect(() => resolveLiveKnowledgeItem('note-1')).toThrow('db busy')
  })
})

describe('resolveLiveKnowledgeSubtree', () => {
  beforeEach(() => {
    knowledgeItemGetSubtreeItemsMock.mockReset()
  })

  it('returns the resolved items when none are deleting', () => {
    const items = [createItem('dir-1'), createItem('note-1')]
    knowledgeItemGetSubtreeItemsMock.mockReturnValue(items)

    expect(resolveLiveKnowledgeSubtree('kb-1', ['dir-1'])).toEqual({ items })
  })

  it('skips when any resolved item is deleting', () => {
    knowledgeItemGetSubtreeItemsMock.mockReturnValue([createItem('dir-1'), createItem('note-1', 'deleting')])

    expect(resolveLiveKnowledgeSubtree('kb-1', ['dir-1'])).toEqual({ skip: 'deleting' })
  })
})
