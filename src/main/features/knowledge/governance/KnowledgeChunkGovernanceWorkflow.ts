import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeChunkGovernanceService } from '@data/services/KnowledgeChunkGovernanceService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import {
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
