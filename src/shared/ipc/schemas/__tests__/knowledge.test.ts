import { describe, expect, it } from 'vitest'

import { KNOWLEDGE_RUNTIME_ITEMS_MAX } from '@shared/data/types/knowledge'

import { knowledgeRequestSchemas } from '../knowledge'

describe('knowledge.add_items IPC schema', () => {
  const input = knowledgeRequestSchemas['knowledge.add_items'].input
  const fileItem = (index: number) => ({
    type: 'file' as const,
    data: { source: `/docs/doc-${index}.pdf`, path: `/docs/doc-${index}.pdf` }
  })

  it('accepts a whole selection beyond the delete/reindex runtime cap in one call', () => {
    const items = Array.from({ length: KNOWLEDGE_RUNTIME_ITEMS_MAX + 1 }, (_, index) => fileItem(index))

    const result = input.safeParse({ baseId: 'base-1', items, conflictStrategy: 'detect' })

    expect(result.success).toBe(true)
    expect(result.data?.items).toHaveLength(KNOWLEDGE_RUNTIME_ITEMS_MAX + 1)
  })

  it('still rejects an empty selection', () => {
    expect(input.safeParse({ baseId: 'base-1', items: [] }).success).toBe(false)
  })
})
