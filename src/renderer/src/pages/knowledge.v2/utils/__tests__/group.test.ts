import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import { buildKnowledgeBaseGroupSections } from '..'

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: '',
  name: '',
  description: undefined,
  groupId: null,
  emoji: '📁',
  dimensions: 1536,
  embeddingModelId: null,
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  threshold: undefined,
  documentCount: undefined,
  searchMode: undefined,
  hybridAlpha: undefined,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

const createGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 'group-1',
  entityType: 'knowledge',
  name: 'Research',
  orderKey: 'a0',
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
  ...overrides
})

describe('buildKnowledgeV2BaseGroupSections', () => {
  it('orders known groups by the real group list and keeps ungrouped bases in a null section', () => {
    const bases = [
      createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-2' }),
      createKnowledgeBase({ id: 'base-2', name: 'Beta', groupId: null }),
      createKnowledgeBase({ id: 'base-3', name: 'Gamma', groupId: 'group-1' })
    ]
    const groups = [
      createGroup({ id: 'group-1', name: 'Research', orderKey: 'a0' }),
      createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })
    ]

    expect(buildKnowledgeBaseGroupSections(bases, groups, '')).toEqual([
      {
        groupId: 'group-1',
        items: [bases[2]]
      },
      {
        groupId: 'group-2',
        items: [bases[0]]
      },
      {
        groupId: null,
        items: [bases[1]]
      }
    ])
  })

  it('filters group sections by knowledge base name', () => {
    const bases = [
      createKnowledgeBase({ id: 'base-1', name: 'Alpha Docs', groupId: 'group-1' }),
      createKnowledgeBase({ id: 'base-2', name: 'Beta Notes', groupId: 'group-2' })
    ]
    const groups = [
      createGroup({ id: 'group-1', name: 'Research', orderKey: 'a0' }),
      createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })
    ]

    expect(buildKnowledgeBaseGroupSections(bases, groups, 'notes')).toEqual([
      {
        groupId: 'group-2',
        items: [bases[1]]
      }
    ])
  })

  it('appends unknown group ids after real groups and before ungrouped', () => {
    const bases = [
      createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-2' }),
      createKnowledgeBase({ id: 'base-2', name: 'Beta', groupId: 'orphan-group' }),
      createKnowledgeBase({ id: 'base-3', name: 'Gamma', groupId: null })
    ]
    const groups = [createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a0' })]

    expect(buildKnowledgeBaseGroupSections(bases, groups, '')).toEqual([
      {
        groupId: 'group-2',
        items: [bases[0]]
      },
      {
        groupId: 'orphan-group',
        items: [bases[1]]
      },
      {
        groupId: null,
        items: [bases[2]]
      }
    ])
  })
})
