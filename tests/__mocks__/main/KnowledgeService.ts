import { vi } from 'vitest'

export const MockMainKnowledgeServiceExport = {
  knowledgeService: {
    withPortableSnapshotBoundary: vi.fn(async (_baseId: string, work: () => unknown | Promise<unknown>) => work()),
    reconcileRestoredBaseFromMaterial: vi.fn(async () => 'completed' as const),
    cancelRestoredMaterialRebuild: vi.fn(async () => {})
  }
}
