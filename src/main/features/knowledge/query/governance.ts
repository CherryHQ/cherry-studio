import { knowledgeChunkGovernanceService } from '@data/services/KnowledgeChunkGovernanceService'
import { DataApiErrorFactory } from '@shared/data/api/errors'

import type { KnowledgeIndexStore } from '../pipeline/vectorstore/indexStore/KnowledgeIndexStore'
import type { KnowledgeIndexSearchExclusions } from '../pipeline/vectorstore/indexStore/model'

export interface KnowledgeGovernanceSearchSnapshot {
  key: string
  exclusions: KnowledgeIndexSearchExclusions
}

/**
 * Main decisions and index identity are read synchronously, without yielding to
 * a mutation job. Re-read at async boundaries rather than treating two databases
 * as one transaction or trusting a cached renderer policy.
 */
export function readKnowledgeGovernanceSearchSnapshot(
  baseId: string,
  store: KnowledgeIndexStore
): KnowledgeGovernanceSearchSnapshot {
  if (store.isClosed()) {
    throw DataApiErrorFactory.invalidOperation(
      'search',
      `Knowledge base '${baseId}' index store was closed during search; retry the operation`
    )
  }
  const records = knowledgeChunkGovernanceService.listByBase(baseId)
  const exclusions = records.length
    ? store.resolveGovernanceExclusions(
        records.map((record) => ({
          unitId: record.unitId,
          materialId: record.itemId,
          sourceContentHash: record.sourceContentHash,
          charStart: record.charStart,
          charEnd: record.charEnd,
          originalText: record.originalText,
          excluded: record.state.excluded,
          pendingOverride: record.state.overrideText !== null
        }))
      )
    : { unitIds: [], materialIds: [] }
  return {
    key: JSON.stringify([records.map((record) => [record.id, record.revision]), exclusions]),
    exclusions
  }
}

export function assertKnowledgeGovernanceSearchSnapshot(
  baseId: string,
  store: KnowledgeIndexStore,
  expected: KnowledgeGovernanceSearchSnapshot
): void {
  if (readKnowledgeGovernanceSearchSnapshot(baseId, store).key !== expected.key) {
    throw DataApiErrorFactory.conflict(
      'Knowledge chunk decisions or indexed source changed during search; retry the operation'
    )
  }
}
