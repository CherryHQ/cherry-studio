import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { externalKnowledgeSourceService } from '@data/services/ExternalKnowledgeSourceService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { ExternalKnowledgeSource, ExternalKnowledgeSyncTrigger } from '@shared/data/types/externalKnowledge'
import type { ExternalKnowledgeScopeResolution } from '@shared/data/types/externalKnowledgeRead'

import { assertBaseCanRunRuntimeOperation } from '../base/baseGuards'
import { knowledgeExternalSourceSyncIdempotencyKey, knowledgeQueueName, toKnowledgeBaseId } from '../types'
import { notifyExternalKnowledgeSourceChange } from './externalKnowledgeDataChange'

export type CreateExternalKnowledgeSourceCommand = {
  baseId: string
  connectionId: string
  url: string
  name: string
}

export type RequestExternalKnowledgeSourceSyncCommand = {
  sourceId: string
}

type ScopeRuntime = {
  resolveFeishuScope(connectionId: string, url: string): Promise<ExternalKnowledgeScopeResolution>
}

type AdmissionDependencies = {
  now(): number
}

export class ExternalKnowledgeSyncAdmission {
  constructor(
    private readonly runtime: ScopeRuntime,
    private readonly dependencies: AdmissionDependencies = { now: Date.now }
  ) {}

  async create(input: CreateExternalKnowledgeSourceCommand): Promise<ExternalKnowledgeSource> {
    const name = input.name.trim()
    if (!name) {
      throw DataApiErrorFactory.validation({ name: ['Name must not be blank'] })
    }
    assertBaseCanRunRuntimeOperation(input.baseId, 'create external knowledge source')
    const resolution = await this.runtime.resolveFeishuScope(input.connectionId, input.url)
    const dbService = application.get('DbService')
    const sourceId = dbService.withWriteTx((tx) => {
      const source = externalKnowledgeSourceService.createTx(tx, {
        baseId: input.baseId,
        connectionId: input.connectionId,
        provider: 'feishu',
        tenantId: resolution.tenantId,
        spaceId: resolution.spaceId,
        scope: resolution.scope,
        name
      })
      this.enqueueSyncTx(tx, source, 'initial')
      return source.id
    })
    const source = externalKnowledgeSourceService.getById(sourceId)
    if (!source) {
      throw DataApiErrorFactory.dataInconsistent('ExternalKnowledgeSource', 'Committed source is missing')
    }
    notifyExternalKnowledgeSourceChange(source.baseId, source.id, 'membership')
    return source
  }

  async requestSync(input: RequestExternalKnowledgeSourceSyncCommand): Promise<ExternalKnowledgeSource> {
    const changed = application.get('DbService').withWriteTx((tx) => {
      const source = externalKnowledgeSourceService.getByIdTx(tx, input.sourceId)
      if (!source) throw DataApiErrorFactory.notFound('ExternalKnowledgeSource', input.sourceId)
      this.assertSourceCanSync(source)
      return this.enqueueSyncTx(tx, source, 'manual')
    })

    const source = externalKnowledgeSourceService.getById(input.sourceId)
    if (!source) {
      throw DataApiErrorFactory.dataInconsistent('ExternalKnowledgeSource', 'Committed source is missing')
    }
    if (changed) notifyExternalKnowledgeSourceChange(source.baseId, source.id, 'projection')
    return source
  }

  private assertSourceCanSync(source: ExternalKnowledgeSource): void {
    this.assertSourceIsActive(source)
    assertBaseCanRunRuntimeOperation(source.baseId, 'synchronize external knowledge source')
  }

  private assertSourceIsActive(source: ExternalKnowledgeSource): void {
    if (source.state === 'paused') {
      throw DataApiErrorFactory.invalidOperation('synchronize external knowledge source', 'source is paused')
    }
  }

  private enqueueSyncTx(tx: DbOrTx, source: ExternalKnowledgeSource, trigger: ExternalKnowledgeSyncTrigger): boolean {
    const baseId = toKnowledgeBaseId(source.baseId)
    const handle = application.get('JobManager').enqueueTx(
      tx,
      'knowledge.sync-external-source',
      { baseId: source.baseId, sourceId: source.id, sourceRevision: source.revision, trigger },
      {
        queue: knowledgeQueueName(baseId),
        idempotencyKey: knowledgeExternalSourceSyncIdempotencyKey(baseId, source.id)
      }
    )
    if (source.activeJobId === handle.id) return false

    const changed = externalKnowledgeSourceService.beginSyncTx(tx, {
      sourceId: source.id,
      expectedRevision: source.revision,
      expectedActiveJobId: source.activeJobId,
      jobId: handle.id,
      trigger,
      startedAt: this.dependencies.now()
    })
    if (!changed) {
      throw DataApiErrorFactory.concurrentModification('ExternalKnowledgeSource', source.id)
    }
    return true
  }
}
