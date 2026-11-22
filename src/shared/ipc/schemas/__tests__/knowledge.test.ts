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

describe('source review IPC authority', () => {
  const valid = {
    baseId: '11111111-1111-4111-8111-111111111111',
    itemId: '22222222-2222-4222-8222-222222222222',
    governanceId: '33333333-3333-4333-8333-333333333333',
    expectedRevision: 1,
    currentSourceContentHash: null,
    action: { kind: 'discard' }
  }
  const schema = knowledgeRequestSchemas['knowledge.review_chunk_governance'].input
  it('allows missing indexed source evidence only as an explicit nullable hash', () => {
    expect(schema.parse(valid)).toEqual(valid)
    expect(schema.safeParse({ ...valid, currentSourceContentHash: undefined }).success).toBe(false)
  })
  it.each([
    { expectedRevision: 0 },
    { originalText: 'forged source' },
    { action: { kind: 'rebind', targetUnitId: 'a'.repeat(64) } },
    {
      action: {
        kind: 'rebind',
        targetUnitId: 'a'.repeat(64),
        expectedTargetRevision: 0,
        overrideText: 'forged correction'
      }
    }
  ])('rejects unversioned review or caller-supplied source/correction evidence: %j', (change) => {
    expect(schema.safeParse({ ...valid, ...change }).success).toBe(false)
  })
})
