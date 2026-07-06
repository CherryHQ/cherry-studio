import { describe, expect, it } from 'vitest'

import { buildKnowledgeSearchModeOptions } from '../rag'

const t = (key: string) =>
  (
    ({
      'knowledge.rag.search_mode.hybrid': '混合检索（推荐）',
      'knowledge.rag.search_mode.vector': '向量检索',
      'knowledge.rag.search_mode.bm25': '全文检索'
    }) as Record<string, string>
  )[key]

describe('buildKnowledgeSearchModeOptions', () => {
  it('offers only bm25 when there is no embedding model', () => {
    expect(buildKnowledgeSearchModeOptions(null, t)).toEqual([{ value: 'bm25', label: '全文检索' }])
  })

  it('offers hybrid, vector, and bm25 once an embedding model is set', () => {
    expect(buildKnowledgeSearchModeOptions('openai::text-embedding-3-small', t)).toEqual([
      { value: 'hybrid', label: '混合检索（推荐）' },
      { value: 'vector', label: '向量检索' },
      { value: 'bm25', label: '全文检索' }
    ])
  })
})
