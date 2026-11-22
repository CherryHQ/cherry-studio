import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeChunkGovernanceService } from '@data/services/KnowledgeChunkGovernanceService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import {
  KnowledgeChunkReviewInputSchema,
  type KnowledgeChunkReviewInput,
  type KnowledgeChunkReviewList,
  KnowledgeChunkBatchInputSchema,
  type KnowledgeChunkBatchInput
} from '@shared/data/types/knowledgeChunkGovernance'
import type { KeyedMutex } from '@shared/utils/async'

import { computeUnitId, hashContentText } from '../pipeline/vectorstore/indexStore/hashing'
import type { KnowledgeSearchUnit } from '../pipeline/vectorstore/indexStore/model'
import { readKnowledgeGovernanceSearchSnapshot } from '../query/governance'

/** Runtime command: authenticate disposable-index evidence, then atomically persist business decisions. */
export class KnowledgeChunkGovernanceWorkflow {
  constructor(private readonly lock: KeyedMutex) {}

  listReviews(baseId: string, itemId: string): KnowledgeChunkReviewList {
    const base = knowledgeBaseService.getById(baseId)
    const item = knowledgeItemService.getById(itemId)
    if (
      base.status !== 'completed' ||
      item.baseId !== baseId ||
      item.status !== 'completed' ||
      item.type === 'directory'
    )
      throw DataApiErrorFactory.conflict('Review requires a completed source in this base')
    const store = application.get('KnowledgeVectorStoreService').getIndexStore(base)
    if (store.isClosed()) throw DataApiErrorFactory.conflict('Index is unavailable; refresh before reviewing')
    const content = store.readMaterialContent(itemId)
    const currentSourceContentHash = content === null ? null : hashContentText(content)
    const active = knowledgeChunkGovernanceService
      .listByBase(baseId)
      .filter((row) => row.itemId === itemId && !row.retired)
    const bindings = active.map((row) => ({
      unitId: row.unitId,
      materialId: itemId,
      sourceContentHash: row.sourceContentHash,
      charStart: row.charStart,
      charEnd: row.charEnd,
      originalText: row.originalText,
      excluded: false,
      pendingOverride: false
    }))
    if (!store.resolveGovernanceExclusions(bindings).materialIds.includes(itemId))
      return { currentSourceContentHash, records: [] }
    const records = active
      .filter(
        (row, index) =>
          currentSourceContentHash !== row.sourceContentHash ||
          store.resolveGovernanceExclusions([bindings[index]]).materialIds.includes(itemId)
      )
      .map((row) => ({
        id: row.id,
        unitId: row.unitId,
        revision: row.revision,
        sourceContentHash: row.sourceContentHash,
        charStart: row.charStart,
        charEnd: row.charEnd,
        originalText: row.originalText,
        state: row.state,
        reason:
          content === null
            ? ('source-unavailable' as const)
            : currentSourceContentHash !== row.sourceContentHash
              ? ('source-changed' as const)
              : ('chunk-changed' as const)
      }))
    return { currentSourceContentHash, records }
  }

  async review(input: KnowledgeChunkReviewInput): Promise<void> {
    const dto = KnowledgeChunkReviewInputSchema.parse(input)
    await this.lock.runExclusive(dto.baseId, () => {
      const view = this.listReviews(dto.baseId, dto.itemId)
      const old = view.records.find((row) => row.id === dto.governanceId)
      if (
        view.currentSourceContentHash !== dto.currentSourceContentHash ||
        !old ||
        old.revision !== dto.expectedRevision
      )
        throw DataApiErrorFactory.conflict('Source or decision changed; refresh and review again')
      const store = application
        .get('KnowledgeVectorStoreService')
        .getIndexStore(knowledgeBaseService.getById(dto.baseId))
      let target: Parameters<typeof knowledgeChunkGovernanceService.review>[0]['target']
      const action = dto.action
      if (action.kind === 'rebind') {
        const content = store.readMaterialContent(dto.itemId)
        const unit = store.listMaterialUnits(dto.itemId).find((unit) => unit.unitId === action.targetUnitId)
        if (
          content === null ||
          !unit ||
          view.currentSourceContentHash === null ||
          content.slice(unit.charStart, unit.charEnd) !== unit.text ||
          computeUnitId(
            dto.itemId,
            view.currentSourceContentHash,
            unit.unitType,
            unit.unitIndex,
            unit.charStart,
            unit.charEnd
          ) !== unit.unitId
        )
          throw DataApiErrorFactory.conflict('Target chunk changed; refresh and review again')
        target = {
          expectedRevision: action.expectedTargetRevision,
          source: {
            baseId: dto.baseId,
            itemId: dto.itemId,
            unitId: unit.unitId,
            sourceContentHash: view.currentSourceContentHash,
            charStart: unit.charStart,
            charEnd: unit.charEnd,
            originalText: unit.text
          }
        }
      }
      knowledgeChunkGovernanceService.review({ ...dto, target })
    })
  }

  async apply(input: KnowledgeChunkBatchInput): Promise<void> {
    const dto = KnowledgeChunkBatchInputSchema.parse(input)
    await this.lock.runExclusive(dto.baseId, () => {
      const base = knowledgeBaseService.getById(dto.baseId)
      if (base.status !== 'completed')
        throw DataApiErrorFactory.invalidOperation('Chunk changes require a completed base')
      const store = application.get('KnowledgeVectorStoreService').getIndexStore(base)
      const snapshot = readKnowledgeGovernanceSearchSnapshot(dto.baseId, store)
      const materials = new Map<
        string,
        { content: string; contentHash: string; units: Map<string, KnowledgeSearchUnit> }
      >()
      const entries = dto.selection.map((selected) => {
        if (!materials.has(selected.itemId)) {
          const item = knowledgeItemService.getById(selected.itemId)
          if (item.baseId !== dto.baseId || item.status !== 'completed' || item.type === 'directory') {
            throw DataApiErrorFactory.conflict('Chunk source is unavailable or belongs to another base')
          }
          if (snapshot.exclusions.materialIds.includes(item.id)) {
            throw DataApiErrorFactory.conflict('Source changed; its chunk decisions need review before editing')
          }
          const content = store.readMaterialContent(item.id)
          if (content === null)
            throw DataApiErrorFactory.conflict('Indexed source is unavailable; reload the selection')
          materials.set(item.id, {
            content,
            contentHash: hashContentText(content),
            units: new Map(store.listMaterialUnits(item.id).map((unit) => [unit.unitId, unit]))
          })
        }
        const material = materials.get(selected.itemId)!
        const unit = material.units.get(selected.unitId)
        if (
          !unit ||
          material.contentHash !== selected.sourceContentHash ||
          material.content.slice(unit.charStart, unit.charEnd) !== unit.text ||
          computeUnitId(
            selected.itemId,
            material.contentHash,
            unit.unitType,
            unit.unitIndex,
            unit.charStart,
            unit.charEnd
          ) !== unit.unitId
        ) {
          throw DataApiErrorFactory.conflict('Indexed chunk changed; reload the selection')
        }
        return {
          expectedRevision: selected.expectedRevision,
          source: {
            baseId: dto.baseId,
            itemId: selected.itemId,
            unitId: unit.unitId,
            sourceContentHash: material.contentHash,
            charStart: unit.charStart,
            charEnd: unit.charEnd,
            originalText: unit.text
          }
        }
      })
      knowledgeChunkGovernanceService.applyBatch(dto.baseId, entries, dto.action)
    })
  }
}
