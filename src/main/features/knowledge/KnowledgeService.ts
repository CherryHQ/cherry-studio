import { application } from '@application'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
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
