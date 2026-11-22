import { knowledgeChunkGovernanceService } from '@data/services/KnowledgeChunkGovernanceService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { type KnowledgeChunkGovernanceView } from '@shared/data/types/knowledgeChunkGovernance'

import { hashContentText } from '../pipeline/vectorstore/indexStore/hashing'
import type { KnowledgeIndexStore } from '../pipeline/vectorstore/indexStore/KnowledgeIndexStore'
import type { KnowledgeSearchUnit } from '../pipeline/vectorstore/indexStore/model'
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
  const records = knowledgeChunkGovernanceService.listByBase(baseId).filter((record) => !record.retired)
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

export function createKnowledgeChunkGovernanceViewReader(baseId: string, store: KnowledgeIndexStore) {
  const snapshot = readKnowledgeGovernanceSearchSnapshot(baseId, store)
  const paused = new Set(snapshot.exclusions.materialIds)
  const records = new Map(
    knowledgeChunkGovernanceService.listByBase(baseId).map((record) => [`${record.itemId}:${record.unitId}`, record])
  )
  return (itemId: string, units: KnowledgeSearchUnit[]): Map<string, KnowledgeChunkGovernanceView> => {
    const content = store.readMaterialContent(itemId)
    if (typeof content !== 'string') return new Map()
    const sourceContentHash = hashContentText(content)
    return new Map<string, KnowledgeChunkGovernanceView>(
      units.map((unit) => {
        const record = records.get(`${itemId}:${unit.unitId}`)
        return [
          unit.unitId,
          {
            sourceContentHash,
            revision: record?.revision ?? 0,
            excluded: record?.state.excluded ?? false,
            labels: record?.state.labels ?? [],
            status: paused.has(itemId)
              ? 'review-needed'
              : record?.state.overrideText != null
                ? 'pending'
                : record?.state.excluded
                  ? 'excluded'
                  : 'active'
          }
        ]
      })
    )
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
