import { describe, expect, it } from 'vitest'

import { nextKnowledgeItemSort } from '../itemSort'

// Third-click reset must work for time's descending-first cycle as well as ascending-first columns.
describe('knowledge item sort cycle', () => {
  it.each(['name', 'type', 'status', 'updatedAt'] as const)('cycles %s and resets on a different column', (sortBy) => {
    const first = nextKnowledgeItemSort(null, sortBy)
    expect(first).toEqual({ sortBy, sortOrder: sortBy === 'updatedAt' ? 'desc' : 'asc' })
    const second = nextKnowledgeItemSort(first, sortBy)
    expect(second).toEqual({ sortBy, sortOrder: sortBy === 'updatedAt' ? 'asc' : 'desc' })
    expect(nextKnowledgeItemSort(second, sortBy)).toBeNull()
    expect(nextKnowledgeItemSort({ sortBy: sortBy === 'name' ? 'type' : 'name', sortOrder: 'desc' }, sortBy)).toEqual(
      first
    )
  })
})
