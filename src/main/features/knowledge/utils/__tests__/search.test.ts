import type { KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { describe, expect, it } from 'vitest'

import { getInitialSearchScoreKind, withSearchRanks } from '../search'

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

describe('knowledge search utils', () => {
  it('uses relevance score kind only for vector mode, ranking for bm25 and hybrid', () => {
    expect(getInitialSearchScoreKind('vector')).toBe('relevance')
    expect(getInitialSearchScoreKind('bm25')).toBe('ranking')
    expect(getInitialSearchScoreKind('hybrid')).toBe('ranking')
  })

  it('renumbers ranks from final order', () => {
    expect(withSearchRanks([createResult('a', 0.1, 'ranking'), createResult('b', 0.2, 'ranking')])).toEqual([
      expect.objectContaining({ chunkId: 'a', rank: 1 }),
      expect.objectContaining({ chunkId: 'b', rank: 2 })
    ])
  })
})
