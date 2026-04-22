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

describe('buildKnowledgeV2BaseGroupSections', () => {
  it('groups bases by groupId and keeps ungrouped bases in a null section', () => {
    const bases = [
      createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'work' }),
      createKnowledgeBase({ id: 'base-2', name: 'Beta', groupId: null }),
      createKnowledgeBase({ id: 'base-3', name: 'Gamma', groupId: 'work' })
    ]

    expect(buildKnowledgeBaseGroupSections(bases, '')).toEqual([
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
    const bases = [
      createKnowledgeBase({ id: 'base-1', name: 'Alpha Docs', groupId: 'work' }),
      createKnowledgeBase({ id: 'base-2', name: 'Beta Notes', groupId: 'personal' })
    ]

    expect(buildKnowledgeBaseGroupSections(bases, 'notes')).toEqual([
      {
        groupId: 'personal',
        items: [bases[1]]
      }
    ])
  })
})
