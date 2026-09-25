import { describe, expect, it } from 'vitest'

import { ListExternalKnowledgeDocumentsQuerySchema } from '../externalKnowledge'

describe('ListExternalKnowledgeDocumentsQuerySchema', () => {
  it('defaults and caps cursor pagination', () => {
    expect(ListExternalKnowledgeDocumentsQuerySchema.parse({})).toEqual({ limit: 50 })
    expect(ListExternalKnowledgeDocumentsQuerySchema.parse({ cursor: 'cursor', limit: 200 })).toEqual({
      cursor: 'cursor',
      limit: 200
    })
    expect(ListExternalKnowledgeDocumentsQuerySchema.safeParse({ limit: 201 }).success).toBe(false)
  })

  it('rejects unknown query fields', () => {
    expect(ListExternalKnowledgeDocumentsQuerySchema.safeParse({ provider: 'feishu' }).success).toBe(false)
  })
})
