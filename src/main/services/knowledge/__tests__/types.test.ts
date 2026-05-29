import { describe, expect, it, vi } from 'vitest'

import {
  knowledgeDeleteSubtreeIdempotencyKey,
  knowledgeIndexIdempotencyKey,
  knowledgePrepareIdempotencyKey,
  knowledgeReindexSubtreeIdempotencyKey,
  reportKnowledgeProgress,
  toKnowledgeBaseId,
  toKnowledgeItemId,
  toKnowledgeItemIds
} from '../types'

describe('knowledge idempotency keys', () => {
  it('sorts subtree root ids and includes the operation name', () => {
    const baseId = toKnowledgeBaseId('kb-1')
    const itemIds = toKnowledgeItemIds(['note-2', 'dir-1'])

    expect(knowledgeDeleteSubtreeIdempotencyKey(baseId, itemIds)).toBe('knowledge:kb-1:dir-1,note-2:delete')
    expect(knowledgeReindexSubtreeIdempotencyKey(baseId, itemIds)).toBe('knowledge:kb-1:dir-1,note-2:reindex')
  })

  it('includes the operation name for single-item jobs', () => {
    const baseId = toKnowledgeBaseId('kb-1')

    expect(knowledgePrepareIdempotencyKey(baseId, toKnowledgeItemId('dir-1'))).toBe('knowledge:kb-1:dir-1:prepare')
    expect(knowledgeIndexIdempotencyKey(baseId, toKnowledgeItemId('note-1'))).toBe('knowledge:kb-1:note-1:index')
  })

  it('reports typed knowledge progress details', () => {
    const ctx = {
      reportProgress: vi.fn()
    }

    reportKnowledgeProgress(ctx, 40, { stage: 'embedding', currentFile: 0, totalFiles: 1 })

    expect(ctx.reportProgress).toHaveBeenCalledWith(40, { stage: 'embedding', currentFile: 0, totalFiles: 1 })
  })
})
