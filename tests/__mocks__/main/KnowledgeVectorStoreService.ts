import { vi } from 'vitest'

export const MockMainKnowledgeVectorStoreServiceExport = {
  knowledgeVectorStoreService: {
    snapshotPortableIndex: vi.fn(async () => ({ status: 'rebuild' as const, reason: 'missing' as const }))
  }
}
