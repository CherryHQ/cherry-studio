import { application } from '@application'
import { externalKnowledgeSourceService } from '@data/services/ExternalKnowledgeSourceService'
import { loggerService } from '@logger'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import type { ExternalKnowledgeSchedulePolicy, ExternalKnowledgeSource } from '@shared/data/types/externalKnowledge'
import type { ExternalKnowledgeConnection } from '@shared/data/types/externalKnowledgeConnection'
import type {
  ExternalKnowledgeScopePreview,
  ExternalKnowledgeScopeResolution,
  FeishuWikiSpacePage,
  FeishuWikiSpacePreview
} from '@shared/data/types/externalKnowledgeRead'
import type {
  CreateKnowledgeBaseDto,
  KnowledgeAddConflictStrategy,
  KnowledgeAddItemInput,
  KnowledgeAddItemsResult,
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeItemChunk,
  KnowledgeSearchResult,
  RestoreKnowledgeBaseDto,
  RestoreKnowledgeBaseResult
} from '@shared/data/types/knowledge'
import type { AbsoluteFilePath } from '@shared/types/file'

import { KnowledgeBaseAdminService } from './base/KnowledgeBaseAdminService'
import type { OrphanBaseArtifactsInspection } from './base/orphanBaseArtifacts'
import { notifyExternalKnowledgeSourceChange } from './external/externalKnowledgeDataChange'
import {
  type DisconnectExternalKnowledgeSourceCommand,
  ExternalKnowledgeDisconnect
} from './external/ExternalKnowledgeDisconnect'
import {
  type BeginAppRegistrationResult,
  type BeginAuthorizationResult,
  type BeginUserAuthorizationInput,
  ExternalKnowledgeRuntime,
  ExternalKnowledgeRuntimeError
} from './external/ExternalKnowledgeRuntime'
import { ExternalKnowledgeSourceLifecycle } from './external/ExternalKnowledgeSourceLifecycle'
import {
  type CreateExternalKnowledgeSourceCommand,
  ExternalKnowledgeSyncAdmission,
  type RequestExternalKnowledgeSourceSyncCommand
} from './external/ExternalKnowledgeSyncAdmission'
import { ExternalKnowledgeSyncService } from './external/ExternalKnowledgeSyncService'
import { createIndexKnowledgeItem } from './ingestion/indexKnowledgeItem'
import { KnowledgeIngestionService } from './ingestion/KnowledgeIngestionService'
import type {
  KnowledgeConceptContent,
  KnowledgeConceptGrep,
  KnowledgeConceptMutationResult,
  KnowledgeOrganizationTree
} from './query/KnowledgeConceptService'
import { KnowledgeConceptService } from './query/KnowledgeConceptService'
import { KnowledgeQueryService } from './query/KnowledgeQueryService'
import { createCheckFileProcessingResultJobHandler } from './tasks/checkFileProcessingResultJobHandler'
import { createDeleteSubtreeJobHandler } from './tasks/deleteSubtreeJobHandler'
import { createIndexDocumentsJobHandler } from './tasks/indexDocumentsJobHandler'
import { createPrepareRootJobHandler } from './tasks/prepareRootJobHandler'
import { createReindexSubtreeJobHandler } from './tasks/reindexSubtreeJobHandler'
import { createSyncExternalSourceJobHandler } from './tasks/syncExternalSourceJobHandler'
import type { KnowledgeBaseDiscoveryOptions, KnowledgeBaseDiscoveryPage } from './types'

const logger = loggerService.withContext('Knowledge')

/**
 * Facade of the knowledge feature: registers the job handlers, runs boot-time
 * recovery, and delegates every public operation to the module that owns it —
 * base lifecycle (KnowledgeBaseAdminService), write-side orchestration (ingestion/), and the read
 * side (query/). Holds no domain logic of its own.
 */
@Injectable('KnowledgeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['KnowledgeVectorStoreService', 'JobManager', 'FileProcessingService', 'WebSearchService'])
export class KnowledgeService extends BaseService {
  private externalKnowledgeAdmissionOpen = false
  private externalKnowledgeInitialReconciled = false
  private externalKnowledgeReconciliationRequested = false
  private externalKnowledgeStartupAbort?: AbortController
  private externalKnowledgeStartupReconciliation?: Promise<void>
  private readonly deletingKnowledgeBaseIds = new Map<string, number>()
  private readonly knowledgeLockManager = new KeyedMutex()
  private readonly assertExternalKnowledgeReady = () => {
    if (!this.externalKnowledgeAdmissionOpen) throw new ExternalKnowledgeRuntimeError('stopped')
  }
  private readonly assertExternalKnowledgeBaseAvailable = (baseId: string) => {
    if (this.deletingKnowledgeBaseIds.has(baseId)) {
      throw DataApiErrorFactory.invalidOperation(
        'synchronize external knowledge source',
        'knowledge base is being deleted'
      )
    }
  }
  private readonly externalKnowledgeRuntime = new ExternalKnowledgeRuntime({
    hooks: {
      onReauthorizationRequired: (connectionId) =>
        this.externalKnowledgeSourceLifecycle.pauseForReauthorization(connectionId)
    },
    commitReauthorization: (connectionId, input) =>
      this.externalKnowledgeSourceLifecycle.commitReauthorization(connectionId, input)
  })
  private readonly externalKnowledgeSyncService = new ExternalKnowledgeSyncService(
    this.externalKnowledgeRuntime,
    this.knowledgeLockManager
  )
  private readonly externalKnowledgeSyncAdmission = new ExternalKnowledgeSyncAdmission(this.externalKnowledgeRuntime, {
    now: Date.now,
    assertOpen: this.assertExternalKnowledgeReady,
    assertBaseAvailable: this.assertExternalKnowledgeBaseAvailable
  })
  private readonly externalKnowledgeSourceLifecycle = new ExternalKnowledgeSourceLifecycle(
    this.externalKnowledgeSyncAdmission
  )
  private readonly externalKnowledgeDisconnect = new ExternalKnowledgeDisconnect(this.knowledgeLockManager)
  private readonly indexKnowledgeItem = createIndexKnowledgeItem(this.knowledgeLockManager)
  private readonly ingestionService = new KnowledgeIngestionService(this.knowledgeLockManager)
  private readonly baseAdmin = new KnowledgeBaseAdminService(
    this.knowledgeLockManager,
    this.ingestionService,
    this.externalKnowledgeDisconnect
  )
  private readonly queryService = new KnowledgeQueryService()
  private readonly conceptService = new KnowledgeConceptService(this.ingestionService)

  protected onInit(): void {
    const jobManager = application.get('JobManager')
    jobManager.registerHandler(
      'knowledge.prepare-root',
      createPrepareRootJobHandler(this.knowledgeLockManager, this.ingestionService)
    )
    jobManager.registerHandler('knowledge.index-documents', createIndexDocumentsJobHandler(this.indexKnowledgeItem))
    jobManager.registerHandler(
      'knowledge.check-file-processing-result',
      createCheckFileProcessingResultJobHandler(this.knowledgeLockManager, this.ingestionService)
    )
    jobManager.registerHandler('knowledge.delete-subtree', createDeleteSubtreeJobHandler(this.knowledgeLockManager))
    jobManager.registerHandler(
      'knowledge.reindex-subtree',
      createReindexSubtreeJobHandler(this.knowledgeLockManager, this.ingestionService)
    )
    jobManager.registerHandler(
      'knowledge.sync-external-source',
      createSyncExternalSourceJobHandler(this.externalKnowledgeSyncService, {
        now: Date.now,
        dispatchScheduledEnvelope: (input, trigger) =>
          this.externalKnowledgeSourceLifecycle.dispatchScheduledEnvelope(input, trigger)
      })
    )
  }

  protected async onReady(): Promise<void> {
    await this.externalKnowledgeRuntime.start()
    try {
      this.externalKnowledgeSourceLifecycle.reconcilePersistedReauthorization()
    } catch (error) {
      try {
        await this.externalKnowledgeRuntime.stop()
      } catch (stopError) {
        throw new AggregateError([error, stopError], 'Failed to reconcile External Knowledge startup state')
      }
      throw error
    }
    if (this.externalKnowledgeInitialReconciled) {
      this.externalKnowledgeAdmissionOpen = true
    } else if (this.externalKnowledgeReconciliationRequested) {
      this.startExternalKnowledgeReconciliation()
    }
  }

  protected async onStop(): Promise<void> {
    this.externalKnowledgeAdmissionOpen = false
    const failures: unknown[] = []
    const startupAbort = this.externalKnowledgeStartupAbort
    const startupReconciliation = this.externalKnowledgeStartupReconciliation
    startupAbort?.abort(new Error('Knowledge service stopped during external knowledge reconciliation'))
    if (startupReconciliation) {
      try {
        await startupReconciliation
      } catch (error) {
        if (!startupAbort?.signal.aborted) failures.push(error)
      }
    }

    let activeJobs: Array<{ id: string }> = []
    try {
      activeJobs = await application.get('JobManager').list({
        status: ['pending', 'delayed', 'running'],
        type: 'knowledge.sync-external-source'
      })
    } catch (error) {
      failures.push(error)
    }

    const cancellationResults = await Promise.allSettled(
      activeJobs.map((job) => application.get('JobManager').cancel(job.id, 'knowledge-service-stop'))
    )
    for (const [index, result] of cancellationResults.entries()) {
      if (result.status === 'rejected') {
        failures.push(result.reason)
      } else if (result.value.outcome === 'timed-out') {
        failures.push(new Error(`External sync job cancellation timed out: ${activeJobs[index].id}`))
      }
    }

    if (failures.length === 0) {
      try {
        await this.externalKnowledgeRuntime.stop()
      } catch (error) {
        failures.push(error)
      }
    }

    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Failed to stop External Knowledge')
  }

  protected onAllReady(): void {
    this.externalKnowledgeSyncService.recoverDeletingItems()
    this.ingestionService.recoverInterruptedItems()
    this.externalKnowledgeReconciliationRequested = true
    this.startExternalKnowledgeReconciliation()
  }

  private startExternalKnowledgeReconciliation(): void {
    if (this.externalKnowledgeInitialReconciled || this.externalKnowledgeStartupReconciliation) return

    const controller = new AbortController()
    const reconciliation = Promise.resolve()
      .then(() => this.externalKnowledgeSourceLifecycle.reconcileAllActiveJobs(controller.signal))
      .then(() => {
        if (controller.signal.aborted) return
        this.externalKnowledgeInitialReconciled = true
        this.externalKnowledgeAdmissionOpen = true
      })
    this.externalKnowledgeStartupAbort = controller
    this.externalKnowledgeStartupReconciliation = reconciliation
    void reconciliation
      .catch((error) => {
        if (!controller.signal.aborted) {
          logger.error('Failed to reconcile External Knowledge jobs during startup', error as Error)
        }
      })
      .finally(() => {
        if (this.externalKnowledgeStartupReconciliation === reconciliation) {
          this.externalKnowledgeStartupAbort = undefined
          this.externalKnowledgeStartupReconciliation = undefined
        }
      })
  }

  async beginFeishuAppRegistration(): Promise<BeginAppRegistrationResult> {
    this.assertExternalKnowledgeReady()
    return await this.externalKnowledgeRuntime.beginAppRegistration()
  }

  async cancelFeishuAppRegistration(registrationSessionId: string): Promise<void> {
    await this.externalKnowledgeRuntime.cancelAppRegistration(registrationSessionId)
  }

  async beginFeishuUserAuthorization(input: BeginUserAuthorizationInput): Promise<BeginAuthorizationResult> {
    this.assertExternalKnowledgeReady()
    return await this.externalKnowledgeRuntime.beginUserAuthorization(input)
  }

  async completeFeishuUserAuthorization(authorizationSessionId: string): Promise<ExternalKnowledgeConnection> {
    this.assertExternalKnowledgeReady()
    return await this.externalKnowledgeRuntime.completeUserAuthorization(authorizationSessionId)
  }

  async cancelFeishuUserAuthorization(authorizationSessionId: string): Promise<void> {
    await this.externalKnowledgeRuntime.cancelUserAuthorization(authorizationSessionId)
  }

  async reconnectFeishuConnection(
    connectionId: string,
    replacement?: BeginUserAuthorizationInput,
    includeSpaceDiscovery?: boolean
  ): Promise<BeginAuthorizationResult> {
    this.assertExternalKnowledgeReady()
    return await this.externalKnowledgeRuntime.beginReconnect(connectionId, replacement, includeSpaceDiscovery)
  }

  async validateFeishuConnection(connectionId: string): Promise<ExternalKnowledgeConnection> {
    this.assertExternalKnowledgeReady()
    return await this.externalKnowledgeRuntime.validateConnection(connectionId)
  }

  async resolveFeishuScope(connectionId: string, url: string): Promise<ExternalKnowledgeScopeResolution> {
    this.assertExternalKnowledgeReady()
    return await this.externalKnowledgeRuntime.resolveFeishuScope(connectionId, url)
  }

  async previewFeishuScope(connectionId: string, url: string): Promise<ExternalKnowledgeScopePreview> {
    this.assertExternalKnowledgeReady()
    return await this.externalKnowledgeRuntime.previewFeishuScope(connectionId, url)
  }

  async listFeishuSpaces(connectionId: string, pageToken?: string): Promise<FeishuWikiSpacePage> {
    this.assertExternalKnowledgeReady()
    return await this.externalKnowledgeRuntime.listFeishuSpaces(connectionId, pageToken)
  }

  async previewFeishuSpace(connectionId: string, spaceId: string): Promise<FeishuWikiSpacePreview> {
    this.assertExternalKnowledgeReady()
    return await this.externalKnowledgeRuntime.previewFeishuSpace(connectionId, spaceId)
  }

  async createExternalKnowledgeSource(input: CreateExternalKnowledgeSourceCommand): Promise<ExternalKnowledgeSource> {
    return await this.externalKnowledgeSyncAdmission.create(input)
  }

  renameExternalKnowledgeSource(input: { sourceId: string; name: string }): ExternalKnowledgeSource {
    const source = externalKnowledgeSourceService.rename(input.sourceId, input.name)
    notifyExternalKnowledgeSourceChange(source.baseId, source.id, 'projection')
    return source
  }

  async requestExternalKnowledgeSourceSync(
    input: RequestExternalKnowledgeSourceSyncCommand
  ): Promise<ExternalKnowledgeSource> {
    this.assertExternalKnowledgeReady()
    await this.externalKnowledgeSourceLifecycle.reconcileSourceActiveJob(input.sourceId)
    return await this.externalKnowledgeSyncAdmission.requestSync(input)
  }

  async updateExternalKnowledgeSourceSchedule(input: {
    sourceId: string
    policy: ExternalKnowledgeSchedulePolicy
  }): Promise<ExternalKnowledgeSource> {
    return await this.externalKnowledgeSourceLifecycle.updateSchedulePolicy(input)
  }

  async disconnectExternalKnowledgeSource(input: DisconnectExternalKnowledgeSourceCommand): Promise<void> {
    await this.externalKnowledgeDisconnect.disconnect(input)
  }

  async removeExternalKnowledgeConnection(connectionId: string): Promise<void> {
    this.assertExternalKnowledgeReady()
    await this.externalKnowledgeRuntime.removeUnreferencedConnection(connectionId)
  }

  async createBase(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    return await this.baseAdmin.createBase(dto)
  }

  async deleteBase(baseId: string): Promise<void> {
    this.deletingKnowledgeBaseIds.set(baseId, (this.deletingKnowledgeBaseIds.get(baseId) ?? 0) + 1)
    try {
      await this.baseAdmin.deleteBase(baseId)
    } finally {
      const remaining = (this.deletingKnowledgeBaseIds.get(baseId) ?? 1) - 1
      if (remaining === 0) {
        this.deletingKnowledgeBaseIds.delete(baseId)
      } else {
        this.deletingKnowledgeBaseIds.set(baseId, remaining)
      }
    }
  }

  async removeOrphanBaseArtifacts(baseId: string): Promise<boolean> {
    return await this.baseAdmin.removeOrphanBaseArtifacts(baseId)
  }

  inspectOrphanBaseArtifacts(): Promise<OrphanBaseArtifactsInspection> {
    return this.baseAdmin.inspectOrphanBaseArtifacts()
  }

  async restoreBase(dto: RestoreKnowledgeBaseDto): Promise<RestoreKnowledgeBaseResult> {
    return await this.baseAdmin.restoreBase(dto)
  }

  listBasesForDiscovery(options: KnowledgeBaseDiscoveryOptions): KnowledgeBaseDiscoveryPage {
    return this.queryService.listBasesForDiscovery(options)
  }

  /** Whether the user has any knowledge base at all — a cheap count (not a full list) for tool-availability gating. */
  hasAnyBase(): boolean {
    return this.baseAdmin.hasAnyBase()
  }

  async addItems(
    baseId: string,
    items: KnowledgeAddItemInput[],
    conflictStrategy?: KnowledgeAddConflictStrategy
  ): Promise<KnowledgeAddItemsResult> {
    return await this.ingestionService.addItems(baseId, items, conflictStrategy)
  }

  async deleteItems(baseId: string, itemIds: string[]): Promise<void> {
    await this.ingestionService.deleteItems(baseId, itemIds)
  }

  async reindexItems(baseId: string, itemIds: string[]): Promise<void> {
    await this.ingestionService.reindexItems(baseId, itemIds)
  }

  /** Configure an embedding model on a BM25-only base and backfill embeddings in place (see KnowledgeIngestionService.enableEmbeddingModel). */
  async enableEmbeddingModel(baseId: string, patch: UpdateKnowledgeBaseDto): Promise<KnowledgeBase> {
    return await this.ingestionService.enableEmbeddingModel(baseId, patch)
  }

  listRootItems(baseId: string): KnowledgeItem[] {
    return this.queryService.listRootItems(baseId)
  }

  /** Absolute on-disk path of a file/url item's stored source bytes, for previewing (see KnowledgeQueryService.getFilePath). */
  getFilePath(itemId: string): AbsoluteFilePath {
    return this.queryService.getFilePath(itemId)
  }

  async search(baseId: string, query: string): Promise<KnowledgeSearchResult[]> {
    return await this.queryService.search(baseId, query)
  }

  async listItemChunks(baseId: string, itemId: string): Promise<KnowledgeItemChunk[]> {
    return await this.queryService.listItemChunks(baseId, itemId)
  }

  async readConcept(
    baseId: string,
    conceptId: string,
    range?: { charStart?: number; charEnd?: number }
  ): Promise<KnowledgeConceptContent> {
    return await this.conceptService.readConcept(baseId, conceptId, range)
  }

  async grepConcept(
    baseId: string,
    conceptId: string,
    options: { pattern: string; ignoreCase?: boolean; maxMatches?: number }
  ): Promise<KnowledgeConceptGrep> {
    return await this.conceptService.grepConcept(baseId, conceptId, options)
  }

  async deleteConcepts(baseId: string, conceptIds: string[]): Promise<KnowledgeConceptMutationResult> {
    return await this.conceptService.deleteConcepts(baseId, conceptIds)
  }

  async refreshConcepts(baseId: string, conceptIds: string[]): Promise<KnowledgeConceptMutationResult> {
    return await this.conceptService.refreshConcepts(baseId, conceptIds)
  }

  getOrganizationTree(baseId: string, options: { maxDepth?: number } = {}): KnowledgeOrganizationTree {
    return this.conceptService.getOrganizationTree(baseId, options)
  }
}
