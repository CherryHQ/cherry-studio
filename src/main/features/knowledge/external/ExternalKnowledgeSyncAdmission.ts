import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { externalKnowledgeConnectionService } from '@data/services/ExternalKnowledgeConnectionService'
import { externalKnowledgeSourceService } from '@data/services/ExternalKnowledgeSourceService'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { DataApiErrorFactory, ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { ExternalKnowledgeSource, ExternalKnowledgeSyncTrigger } from '@shared/data/types/externalKnowledge'
import type { ExternalKnowledgeScopeResolution } from '@shared/data/types/externalKnowledgeRead'

import { assertBaseCanRunRuntimeOperation } from '../base/baseGuards'
import { knowledgeExternalSourceSyncIdempotencyKey, knowledgeQueueName, toKnowledgeBaseId } from '../types'
import { notifyExternalKnowledgeSourceChange } from './externalKnowledgeDataChange'
import { ExternalKnowledgeRuntimeError } from './ExternalKnowledgeRuntime'

type CreateExternalKnowledgeSourceBaseCommand = {
  baseId: string
  connectionId: string
  name: string
}
export type CreateExternalKnowledgeSourceCommand = CreateExternalKnowledgeSourceBaseCommand &
  ({ url: string; spaceId?: never } | { spaceId: string; url?: never })

export type RequestExternalKnowledgeSourceSyncCommand = {
  sourceId: string
}

type ScopeRuntime = {
  resolveFeishuScope(connectionId: string, url: string): Promise<ExternalKnowledgeScopeResolution>
  resolveFeishuSpace(connectionId: string, spaceId: string): Promise<{ tenantId: string; spaceId: string }>
}

type AdmissionDependencies = {
  now(): number
  assertOpen(): void
  assertBaseAvailable(baseId: string): void
}

export type ExternalKnowledgeAdmissionErrorCode = 'source-conflict' | 'target-unavailable'

export class ExternalKnowledgeAdmissionError extends Error {
  constructor(readonly code: ExternalKnowledgeAdmissionErrorCode) {
    super(
      code === 'source-conflict'
        ? 'An external knowledge source already exists for this provider scope'
        : 'The external knowledge source target is unavailable'
    )
    this.name = 'ExternalKnowledgeAdmissionError'
  }
}

export class ExternalKnowledgeSyncAdmission {
  constructor(
    private readonly runtime: ScopeRuntime,
    private readonly dependencies: AdmissionDependencies
  ) {}

  async create(input: CreateExternalKnowledgeSourceCommand): Promise<ExternalKnowledgeSource> {
    const name = input.name.trim()
    if (!name) {
      throw DataApiErrorFactory.validation({ name: ['Name must not be blank'] })
    }
    this.dependencies.assertOpen()
    this.dependencies.assertBaseAvailable(input.baseId)
    const resolution =
      input.spaceId === undefined
        ? await this.runtime.resolveFeishuScope(input.connectionId, input.url)
        : {
            ...(await this.runtime.resolveFeishuSpace(input.connectionId, input.spaceId)),
            scope: { kind: 'space' as const }
          }
    this.dependencies.assertOpen()
    this.dependencies.assertBaseAvailable(input.baseId)
    const dbService = application.get('DbService')
    let sourceId: string
    try {
      sourceId = dbService.withWriteTx((tx) => {
        const base = knowledgeBaseService.getByIdTx(tx, input.baseId)
        if (base.status === 'failed') throw new ExternalKnowledgeAdmissionError('target-unavailable')
        const connection = externalKnowledgeConnectionService.getByIdTx(tx, input.connectionId)
        if (
          !connection ||
          connection.provider !== 'feishu' ||
          connection.authorizationStatus !== 'connected' ||
          connection.tenantKey !== resolution.tenantId
        ) {
          throw new ExternalKnowledgeAdmissionError('target-unavailable')
        }
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
    } catch (error) {
      if (error instanceof ExternalKnowledgeAdmissionError || error instanceof ExternalKnowledgeRuntimeError)
        throw error
      if (isDataApiError(error)) {
        if (error.code === ErrorCode.CONFLICT) throw new ExternalKnowledgeAdmissionError('source-conflict')
        if (error.code === ErrorCode.NOT_FOUND) throw new ExternalKnowledgeAdmissionError('target-unavailable')
      }
      throw error
    }
    const source = externalKnowledgeSourceService.getById(sourceId)
    if (!source) {
      throw DataApiErrorFactory.dataInconsistent('ExternalKnowledgeSource', 'Committed source is missing')
    }
    notifyExternalKnowledgeSourceChange(source.baseId, source.id, 'membership')
    return source
  }

  async requestSync(input: RequestExternalKnowledgeSourceSyncCommand): Promise<ExternalKnowledgeSource> {
    return this.requestSyncForTrigger(input, 'manual')
  }

  async requestSyncForTrigger(
    input: RequestExternalKnowledgeSourceSyncCommand,
    trigger: Exclude<ExternalKnowledgeSyncTrigger, 'initial'>
  ): Promise<ExternalKnowledgeSource> {
    this.dependencies.assertOpen()
    const changed = application.get('DbService').withWriteTx((tx) => {
      const source = externalKnowledgeSourceService.getByIdTx(tx, input.sourceId)
      if (!source) throw DataApiErrorFactory.notFound('ExternalKnowledgeSource', input.sourceId)
      this.dependencies.assertBaseAvailable(source.baseId)
      this.assertSourceCanSync(source)
      return this.enqueueSyncTx(tx, source, trigger)
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
