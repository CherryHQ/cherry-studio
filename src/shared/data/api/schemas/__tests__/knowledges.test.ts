import { describe, expect, it } from 'vitest'

import {
  KNOWLEDGE_BASES_DEFAULT_LIMIT,
  KNOWLEDGE_BASES_DEFAULT_PAGE,
  KNOWLEDGE_BASES_MAX_LIMIT,
  ListKnowledgeBasesQuerySchema
} from '../knowledges'

describe('ListKnowledgeBasesQuerySchema', () => {
  it('trims search and applies pagination defaults', () => {
    expect(ListKnowledgeBasesQuerySchema.parse({ search: '  docs  ' })).toEqual({
      page: KNOWLEDGE_BASES_DEFAULT_PAGE,
      limit: KNOWLEDGE_BASES_DEFAULT_LIMIT,
      search: 'docs'
    })
  })

  it('accepts max limit and rejects blank search', () => {
    expect(ListKnowledgeBasesQuerySchema.parse({ page: 2, limit: KNOWLEDGE_BASES_MAX_LIMIT })).toEqual({
      page: 2,
      limit: KNOWLEDGE_BASES_MAX_LIMIT
    })
    expect(() => ListKnowledgeBasesQuerySchema.parse({ search: '   ' })).toThrow()
  })
})
