import { application } from '@application'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import type { ExternalKnowledgeSource } from '@shared/data/types/externalKnowledge'
import type { ExternalKnowledgeConnection } from '@shared/data/types/externalKnowledgeConnection'
import type {
  ExternalKnowledgeScopePreview,
  ExternalKnowledgeScopeResolution
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
import {
  type BeginAppRegistrationResult,
  type BeginAuthorizationResult,
  type BeginUserAuthorizationInput,
  ExternalKnowledgeRuntime,
  ExternalKnowledgeRuntimeError
} from './external/ExternalKnowledgeRuntime'
import {
  type CreateExternalKnowledgeSourceCommand,
  ExternalKnowledgeSyncAdmission,
  type RequestExternalKnowledgeSourceSyncCommand
} from './external/ExternalKnowledgeSyncAdmission'
import { ExternalKnowledgeSyncService } from './external/ExternalKnowledgeSyncService'
import { createIndexKnowledgeItem } from './ingestion/indexKnowledgeItem'
import { KnowledgeIngestionService } from './ingestion/KnowledgeIngestionService'
import { recoverDeletingKnowledgeItems } from './ingestion/subtreeDeletion'
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
  private readonly knowledgeLockManager = new KeyedMutex()
  private readonly externalKnowledgeRuntime = new ExternalKnowledgeRuntime()
  private readonly externalKnowledgeSyncService = new ExternalKnowledgeSyncService(
    this.externalKnowledgeRuntime,
    this.knowledgeLockManager
  )
  private readonly externalKnowledgeSyncAdmission = new ExternalKnowledgeSyncAdmission(this.externalKnowledgeRuntime, {
    now: Date.now,
    assertOpen: () => {
      if (!this.externalKnowledgeAdmissionOpen) throw new ExternalKnowledgeRuntimeError('stopped')
    }
  })
  private readonly indexKnowledgeItem = createIndexKnowledgeItem(this.knowledgeLockManager)
  private readonly ingestionService = new KnowledgeIngestionService(this.knowledgeLockManager)
  private readonly baseAdmin = new KnowledgeBaseAdminService(this.knowledgeLockManager, this.ingestionService)
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
      createSyncExternalSourceJobHandler(this.externalKnowledgeSyncService)
    )
  }

  protected async onReady(): Promise<void> {
    await this.externalKnowledgeRuntime.start()
    this.externalKnowledgeAdmissionOpen = true
  }

  protected async onStop(): Promise<void> {
    this.externalKnowledgeAdmissionOpen = false
    const failures: unknown[] = []
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

  protected async onAllReady(): Promise<void> {
    recoverDeletingKnowledgeItems()
    this.ingestionService.recoverInterruptedItems()
  }

  async beginFeishuAppRegistration(): Promise<BeginAppRegistrationResult> {
    return await this.externalKnowledgeRuntime.beginAppRegistration()
  }

  async cancelFeishuAppRegistration(registrationSessionId: string): Promise<void> {
    await this.externalKnowledgeRuntime.cancelAppRegistration(registrationSessionId)
  }

  async beginFeishuUserAuthorization(input: BeginUserAuthorizationInput): Promise<BeginAuthorizationResult> {
    return await this.externalKnowledgeRuntime.beginUserAuthorization(input)
  }

  async completeFeishuUserAuthorization(authorizationSessionId: string): Promise<ExternalKnowledgeConnection> {
    return await this.externalKnowledgeRuntime.completeUserAuthorization(authorizationSessionId)
  }

  async cancelFeishuUserAuthorization(authorizationSessionId: string): Promise<void> {
    await this.externalKnowledgeRuntime.cancelUserAuthorization(authorizationSessionId)
  }

  async reconnectFeishuConnection(
    connectionId: string,
    replacement?: BeginUserAuthorizationInput
  ): Promise<BeginAuthorizationResult> {
    return await this.externalKnowledgeRuntime.beginReconnect(connectionId, replacement)
  }

  async validateFeishuConnection(connectionId: string): Promise<ExternalKnowledgeConnection> {
    return await this.externalKnowledgeRuntime.validateConnection(connectionId)
  }

  async resolveFeishuScope(connectionId: string, url: string): Promise<ExternalKnowledgeScopeResolution> {
    return await this.externalKnowledgeRuntime.resolveFeishuScope(connectionId, url)
  }

  async previewFeishuScope(connectionId: string, url: string): Promise<ExternalKnowledgeScopePreview> {
    return await this.externalKnowledgeRuntime.previewFeishuScope(connectionId, url)
  }

  async createExternalKnowledgeSource(input: CreateExternalKnowledgeSourceCommand): Promise<ExternalKnowledgeSource> {
    return await this.externalKnowledgeSyncAdmission.create(input)
  }

  async requestExternalKnowledgeSourceSync(
    input: RequestExternalKnowledgeSourceSyncCommand
  ): Promise<ExternalKnowledgeSource> {
    return await this.externalKnowledgeSyncAdmission.requestSync(input)
  }

  async removeExternalKnowledgeConnection(connectionId: string): Promise<void> {
    await this.externalKnowledgeRuntime.removeUnreferencedConnection(connectionId)
  }

  async createBase(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    return await this.baseAdmin.createBase(dto)
  }

  async deleteBase(baseId: string): Promise<void> {
    await this.baseAdmin.deleteBase(baseId)
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
