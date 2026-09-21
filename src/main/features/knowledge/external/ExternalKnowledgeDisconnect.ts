import { application } from '@application'
import { externalKnowledgeDocumentService } from '@data/services/ExternalKnowledgeDocumentService'
import { externalKnowledgeSourceService } from '@data/services/ExternalKnowledgeSourceService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { DataApiErrorFactory } from '@shared/data/api/errors'

import { enqueueKnowledgeSubtreeDeletionTx } from '../ingestion/subtreeDeletion'
import { cancelJobAndConfirmStopped } from '../tasks/utils/cancel'
import {
  notifyExternalKnowledgeSourceChange,
  notifyExternalKnowledgeSyncContentChange
} from './externalKnowledgeDataChange'

const logger = loggerService.withContext('Knowledge:ExternalDisconnect')

export type DisconnectExternalKnowledgeSourceCommand = {
  sourceId: string
  mode: 'keep-local' | 'remove-local'
}

export class ExternalKnowledgeDisconnect {
  constructor(private readonly knowledgeLockManager: KeyedMutex) {}

  async prepareExternalSourcesForBaseDeletion(baseId: string): Promise<string[]> {
    const sources = externalKnowledgeSourceService.listByBaseId(baseId)
    for (const source of sources) {
      if (source.scheduleId === null) continue
      const unregistered = await application.get('JobManager').unregisterJobScheduleById(source.scheduleId)
      if (!unregistered) {
        throw DataApiErrorFactory.invalidOperation(
          'delete knowledge base',
          `external knowledge source schedule '${source.scheduleId}' could not be unregistered`
        )
      }
    }

    return sources.map((source) => source.id)
  }

  notifyExternalSourcesDeleted(baseId: string, sourceIds: readonly string[]): void {
    for (const sourceId of sourceIds) {
      notifyExternalKnowledgeSourceChange(baseId, sourceId, 'membership')
      notifyExternalKnowledgeSyncContentChange(baseId, sourceId)
    }
  }

  async disconnect(input: DisconnectExternalKnowledgeSourceCommand): Promise<void> {
    const source = externalKnowledgeSourceService.getById(input.sourceId)
    if (!source) throw DataApiErrorFactory.notFound('ExternalKnowledgeSource', input.sourceId)

    if (source.scheduleId !== null) {
      const unregistered = await application.get('JobManager').unregisterJobScheduleById(source.scheduleId)
      if (!unregistered) {
        throw DataApiErrorFactory.invalidOperation(
          'disconnect external knowledge source',
          'source schedule could not be unregistered'
        )
      }
    }

    const disconnectFence = await this.knowledgeLockManager.runExclusive(source.baseId, () =>
      application.get('DbService').withWriteTx((tx) => {
        const prepared = externalKnowledgeSourceService.prepareDisconnectTx(tx, {
          sourceId: source.id,
          expectedRevision: source.revision,
          expectedScheduleId: null
        })
        if (!prepared) throw DataApiErrorFactory.concurrentModification('ExternalKnowledgeSource', source.id)
        return prepared
      })
    )
    notifyExternalKnowledgeSourceChange(disconnectFence.baseId, disconnectFence.id, 'projection')

    await this.settleActiveWork(disconnectFence.activeJobId)

    await this.knowledgeLockManager.runExclusive(disconnectFence.baseId, () => {
      application.get('DbService').withWriteTx((tx) => {
        if (input.mode === 'remove-local') {
          const ownedItemIds = externalKnowledgeDocumentService.listOwnedKnowledgeItemIdsBySourceIdTx(
            tx,
            disconnectFence.id
          )
          knowledgeItemService.setSubtreeStatusTx(tx, disconnectFence.baseId, ownedItemIds, 'deleting')
          enqueueKnowledgeSubtreeDeletionTx(tx, disconnectFence.baseId, ownedItemIds)
        }

        if (
          !externalKnowledgeSourceService.deleteForDisconnectTx(tx, {
            sourceId: disconnectFence.id,
            expectedRevision: disconnectFence.revision,
            expectedScheduleId: null,
            expectedActiveJobId: disconnectFence.activeJobId
          })
        ) {
          throw DataApiErrorFactory.concurrentModification('ExternalKnowledgeSource', disconnectFence.id)
        }
      })
    })

    notifyExternalKnowledgeSourceChange(disconnectFence.baseId, disconnectFence.id, 'membership')
    notifyExternalKnowledgeSyncContentChange(disconnectFence.baseId, disconnectFence.id)
    logger.info('Disconnected external knowledge source', {
      sourceId: disconnectFence.id,
      baseId: disconnectFence.baseId,
      mode: input.mode
    })
  }

  private async settleActiveWork(jobId: string | null): Promise<void> {
    if (jobId === null) return

    try {
      await cancelJobAndConfirmStopped(jobId, 'external-knowledge-source-disconnect')
    } catch {
      throw DataApiErrorFactory.invalidOperation(
        'disconnect external knowledge source',
        `active sync job '${jobId}' could not be settled`
      )
    }
  }
}
