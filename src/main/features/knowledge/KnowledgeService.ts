import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
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
import { KnowledgeIngestionService } from './ingestion/KnowledgeIngestionService'
import { isIndexableKnowledgeItem, toMaterialRelativePath } from './items'
import { probeKnowledgeFile } from './pathStorage'
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
import { narrowKnowledgeJobInput } from './tasks/utils/jobInput'
import {
  KNOWLEDGE_ACTIVE_JOB_STATUSES,
  knowledgeQueueName,
  knowledgeRestoreIndexIdempotencyKey,
  type KnowledgeBaseDiscoveryOptions,
  type KnowledgeBaseDiscoveryPage,
  toKnowledgeBaseId,
  toKnowledgeItemId
} from './types'

const logger = loggerService.withContext('KnowledgeService')

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
  private readonly knowledgeLockManager = new KeyedMutex()
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
    jobManager.registerHandler('knowledge.index-documents', createIndexDocumentsJobHandler(this.knowledgeLockManager))
    jobManager.registerHandler(
      'knowledge.check-file-processing-result',
      createCheckFileProcessingResultJobHandler(this.knowledgeLockManager, this.ingestionService)
    )
    jobManager.registerHandler('knowledge.delete-subtree', createDeleteSubtreeJobHandler(this.knowledgeLockManager))
    jobManager.registerHandler(
      'knowledge.reindex-subtree',
      createReindexSubtreeJobHandler(this.knowledgeLockManager, this.ingestionService)
    )
  }

  protected async onAllReady(): Promise<void> {
    this.ingestionService.recoverDeletingItems()
    this.ingestionService.recoverInterruptedItems()
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

  /**
   * Reconcile the derived index for a base installed by Backup v2. This path is
   * intentionally narrower than user reindex: it reads only material files
   * already transported under the managed base directory and never follows a
   * directory item's original `data.source`, fetches a URL, or scans an external
   * folder. Completion means every completed leaf has a material row, not merely
   * that `index.sqlite` exists.
   */
  async reconcileRestoredBaseFromMaterial(baseId: string, restoreId: string): Promise<'completed' | 'pending'> {
    let base: KnowledgeBase
    try {
      base = knowledgeBaseService.getById(baseId)
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        return 'completed'
      }
      throw error
    }

    if ((await this.listActiveRestoreIndexJobs(baseId, restoreId)).length > 0) return 'pending'

    const items = knowledgeItemService
      .getItemsByBaseId(baseId)
      .filter(isIndexableKnowledgeItem)
      .filter((item) => item.status === 'completed')
    const expected = items.map((item) => ({ item, relativePath: toMaterialRelativePath(item) }))

    for (const { item, relativePath } of expected) {
      const readability = await probeKnowledgeFile(baseId, relativePath)
      if (readability !== 'readable') {
        throw new Error(
          `Restored knowledge material is ${readability}: base=${baseId} item=${item.id} path=${relativePath}`
        )
      }
    }

    if (expected.length === 0) return 'completed'
    const store = application.get('KnowledgeVectorStoreService').getIndexStore(base)
    const missing: typeof expected = []
    for (const entry of expected) {
      if (!store.getMaterialByRelativePath(entry.relativePath)) missing.push(entry)
    }
    if (missing.length === 0) return 'completed'

    const jobManager = application.get('JobManager')
    const knowledgeBaseId = toKnowledgeBaseId(baseId)
    for (const { item } of missing) {
      const itemId = toKnowledgeItemId(item.id)
      jobManager.enqueue(
        'knowledge.index-documents',
        { baseId, itemId, restoreId },
        {
          idempotencyKey: knowledgeRestoreIndexIdempotencyKey(knowledgeBaseId, itemId, restoreId),
          queue: knowledgeQueueName(knowledgeBaseId)
        }
      )
    }
    return 'pending'
  }

  /** Stop every still-active indexing job created by one restore-specific rebuild. */
  async cancelRestoredMaterialRebuild(restoreId: string): Promise<void> {
    const jobManager = application.get('JobManager')
    const jobs = await jobManager.list({
      type: 'knowledge.index-documents',
      status: [...KNOWLEDGE_ACTIVE_JOB_STATUSES]
    })
    const matching = jobs.filter((job) => {
      const narrowed = narrowKnowledgeJobInput(job)
      return narrowed?.type === 'knowledge.index-documents' && narrowed.input.restoreId === restoreId
    })
    const results = await Promise.all(
      matching.map((job) => jobManager.cancel(job.id, 'backup-restore-rebuild-abandoned'))
    )
    const timedOut = results.filter((result) => result.outcome === 'timed-out').length
    if (timedOut > 0) {
      logger.warn('Some abandoned restore indexing jobs did not stop within the cancellation grace period', {
        restoreId,
        timedOut
      })
    }
  }

  private async listActiveRestoreIndexJobs(baseId: string, restoreId: string) {
    const jobs = await application.get('JobManager').list({
      queue: knowledgeQueueName(toKnowledgeBaseId(baseId)),
      status: [...KNOWLEDGE_ACTIVE_JOB_STATUSES]
    })
    return jobs.filter((job) => {
      const narrowed = narrowKnowledgeJobInput(job)
      return narrowed?.type === 'knowledge.index-documents' && narrowed.input.restoreId === restoreId
    })
  }

  /**
   * Configures an embedding model on a base that has never had one (BM25-only), then
   * backfills embeddings for its existing items in place — no restore-into-a-new-base
   * needed, since a BM25-only base has no vectors to invalidate. `knowledgeBaseService.
   * update` still rejects switching an already-configured model this way; that case
   * keeps going through `restoreBase` because it does invalidate existing vectors.
   *
   * Runs the same admission checks `reindexItems` would run, but before committing the
   * model — a base whose backfill is doomed (missing source, subtree still running, ...)
   * must never end up with a model set and no vectors to back it, since there is nothing
   * to roll back to once it is committed.
   */
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
