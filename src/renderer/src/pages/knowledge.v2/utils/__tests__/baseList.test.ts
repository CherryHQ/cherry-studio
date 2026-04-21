import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import { buildKnowledgeV2BaseListItems, filterKnowledgeV2BaseGroupSections } from '../baseList'

const createKnowledgeBase = (overrides: Partial<KnowledgeBase>): KnowledgeBase => ({
  id: '',
  name: '',
  description: undefined,
  groupId: null,
  emoji: '📁',
  dimensions: 1536,
  embeddingModelId: null,
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: undefined,
  chunkOverlap: undefined,
  threshold: undefined,
  documentCount: undefined,
  searchMode: undefined,
  hybridAlpha: undefined,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('buildKnowledgeV2BaseListItems', () => {
  it('applies mocked itemCount and status patches by knowledge base id', () => {
    const bases = [
      createKnowledgeBase({ id: 'base-1', name: 'Base 1', groupId: 'work' }),
      createKnowledgeBase({ id: 'base-2', name: 'Base 2', groupId: null })
    ]

    const result = buildKnowledgeV2BaseListItems(bases, {
      'base-1': { itemCount: 3, status: 'processing' },
      'base-2': { itemCount: 2, status: 'failed' }
    })

    expect(result).toEqual([
      {
        base: bases[0],
        itemCount: 3,
        status: 'processing'
      },
      {
        base: bases[1],
        itemCount: 2,
        status: 'failed'
      }
    ])
  })

  it('uses completed/0 defaults when no patch exists', () => {
    const bases = [createKnowledgeBase({ id: 'base-1', name: 'Base 1', groupId: 'work' })]

    expect(buildKnowledgeV2BaseListItems(bases)).toEqual([
      {
        base: bases[0],
        itemCount: 0,
        status: 'completed'
      }
    ])
  })
})

describe('filterKnowledgeV2BaseGroupSections', () => {
  it('groups bases by groupId and keeps ungrouped bases in a null section', () => {
    const bases = buildKnowledgeV2BaseListItems(
      [
        createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'work' }),
        createKnowledgeBase({ id: 'base-2', name: 'Beta', groupId: null }),
        createKnowledgeBase({ id: 'base-3', name: 'Gamma', groupId: 'work' })
      ],
      {
        'base-1': { itemCount: 1, status: 'completed' },
        'base-2': { itemCount: 2, status: 'completed' },
        'base-3': { itemCount: 1, status: 'processing' }
      }
    )

    expect(filterKnowledgeV2BaseGroupSections(bases, '')).toEqual([
      {
        groupId: 'work',
        items: [bases[0], bases[2]]
      },
      {
        groupId: null,
        items: [bases[1]]
      }
    ])
  })

  it('filters group sections by knowledge base name', () => {
    const bases = buildKnowledgeV2BaseListItems(
      [
        createKnowledgeBase({ id: 'base-1', name: 'Alpha Docs', groupId: 'work' }),
        createKnowledgeBase({ id: 'base-2', name: 'Beta Notes', groupId: 'personal' })
      ],
      {
        'base-1': { itemCount: 1, status: 'completed' },
        'base-2': { itemCount: 1, status: 'completed' }
      }
    )

    expect(filterKnowledgeV2BaseGroupSections(bases, 'notes')).toEqual([
      {
        groupId: 'personal',
        items: [bases[1]]
      }
    ])
  })
})
