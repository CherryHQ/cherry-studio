import type { KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import { applyRelevanceThreshold, getInitialSearchScoreKind, withSearchRanks } from '../search'

const createResult = (
  chunkId: string,
  score: number,
  scoreKind: KnowledgeSearchResult['scoreKind']
): KnowledgeSearchResult => ({
  pageContent: chunkId,
  score,
  scoreKind,
  rank: 1,
  metadata: {
    itemId: `item-${chunkId}`,
    itemType: 'note',
    source: `note-${chunkId}`,
    chunkIndex: 0,
    tokenCount: 1
  },
  chunkId
})

describe('knowledge runtime search utils', () => {
  it('uses relevance score kind only for vector search', () => {
    expect(getInitialSearchScoreKind({ searchMode: 'default' })).toBe('relevance')
    expect(getInitialSearchScoreKind({ searchMode: 'bm25' })).toBe('ranking')
    expect(getInitialSearchScoreKind({ searchMode: 'hybrid' })).toBe('ranking')
  })

  it('applies thresholds only to relevance scores', () => {
    const results = [
      createResult('relevance-low', 0.4, 'relevance'),
      createResult('relevance-high', 0.8, 'relevance'),
      createResult('ranking-low', 0.1, 'ranking')
    ]

    expect(applyRelevanceThreshold(results, 0.7).map((result) => result.chunkId)).toEqual([
      'relevance-high',
      'ranking-low'
    ])
  })

  it('renumbers ranks from final order', () => {
    expect(withSearchRanks([createResult('a', 0.1, 'ranking'), createResult('b', 0.2, 'ranking')])).toEqual([
      expect.objectContaining({ chunkId: 'a', rank: 1 }),
      expect.objectContaining({ chunkId: 'b', rank: 2 })
    ])
  })
})
