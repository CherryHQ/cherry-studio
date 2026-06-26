import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { TraceMethod } from '@mcp-trace/trace-core'
import { DataApiErrorFactory, ErrorCode, isDataApiError } from '@shared/data/api'
import { KNOWLEDGE_BASES_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import {
  type CreateKnowledgeBaseDto,
  getKnowledgeItemDisplayTitle,
  KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED,
  type KnowledgeAddConflictStrategy,
  type KnowledgeAddItemInput,
  KnowledgeAddItemInputSchema,
  type KnowledgeAddItemsResult,
  type KnowledgeBase,
  type KnowledgeItem,
  type KnowledgeItemChunk,
  type KnowledgeItemStatus,
  type KnowledgeItemType,
  type KnowledgeSearchResult,
  type RestoreKnowledgeBaseDto,
  type RestoreKnowledgeBaseResult
} from '@shared/data/types/knowledge'
import { estimateTokenCount } from 'tokenx'

import { KnowledgeLockManager } from './KnowledgeLockManager'
import { KnowledgeWorkflowService } from './KnowledgeWorkflowService'
import { createCheckFileProcessingResultJobHandler } from './tasks/checkFileProcessingResultJobHandler'
import { createDeleteSubtreeJobHandler } from './tasks/deleteSubtreeJobHandler'
import { createIndexDocumentsJobHandler } from './tasks/indexDocumentsJobHandler'
import { createPrepareRootJobHandler } from './tasks/prepareRootJobHandler'
import { createReindexSubtreeJobHandler } from './tasks/reindexSubtreeJobHandler'
import { narrowKnowledgeJobInput } from './tasks/utils/jobInput'
import {
  KNOWLEDGE_ACTIVE_JOB_LIMIT,
  KNOWLEDGE_ACTIVE_JOB_STATUSES,
  KNOWLEDGE_JOB_TYPES,
  knowledgeDeleteSubtreeIdempotencyKey,
  knowledgeQueueName,
  toKnowledgeBaseId,
  toKnowledgeItemId,
  toKnowledgeItemIds
} from './types'
import { embedKnowledgeQuery } from './utils/indexing/embed'
import { toMaterialRelativePath } from './utils/indexing/materialFields'
import { rerankKnowledgeSearchResults } from './utils/indexing/rerank'
import { classifyKnowledgeItemSource } from './utils/items'
import { applyRelevanceThreshold, getInitialSearchScoreKind, withSearchRanks } from './utils/search'
import { getKnowledgeBaseFilePath } from './utils/storage/pathStorage'
import type { KnowledgeIndexStore } from './vectorstore/indexStore/KnowledgeIndexStore'
import type { KnowledgeIndexSearchMatch } from './vectorstore/indexStore/model'

const logger = loggerService.withContext('KnowledgeService')
const SEARCH_TOKEN_PATTERN = /[\p{L}\p{N}_]+/u
const DELETE_RECOVERY_ROOT_CHUNK_SIZE = 500
/**
 * Fetch this many × the requested result count as index candidates. The index
 * store only filters by material state; the item-visibility filter (missing /
 * other-base / not-completed) runs afterwards in the caller and can drop matches,
 * so over-fetching keeps the final set from shrinking below topK.
 */
const KNOWLEDGE_SEARCH_OVERFETCH_FACTOR = 5
/** Hard ceiling on fetched candidates, bounding the brute-force vector scan and rerank cost regardless of topK. */
const KNOWLEDGE_SEARCH_CANDIDATE_CAP = 200
const REINDEX_ALLOWED_STATUSES = new Set<KnowledgeItemStatus>(['completed', 'failed'])
const KNOWLEDGE_JOB_TYPE_SET = new Set<string>(KNOWLEDGE_JOB_TYPES)

/** Max characters {@link KnowledgeService.readConcept} returns in one slice, so a large document can't flood the agent's context. */
const CONCEPT_READ_MAX_CHARS = 20_000
/** Default returned-match cap for {@link KnowledgeService.grepConcept} (the agent may raise it up to {@link CONCEPT_GREP_MAX_MATCHES}). */
const CONCEPT_GREP_DEFAULT_MAX_MATCHES = 50
/** Hard ceiling on returned grep matches, bounding the response size. */
const CONCEPT_GREP_MAX_MATCHES = 200
/** Characters of context kept on each side of a grep match in its snippet. */
const CONCEPT_GREP_SNIPPET_PAD = 60
/** Hard ceiling on nodes {@link KnowledgeService.getOrganizationTree} returns, bounding the response for a huge base. */
const KNOWLEDGE_TREE_MAX_NODES = 1000

/** Verbatim slice of a knowledge concept's indexed text, addressed by Concept ID (the material's relative path, OKF §2). */
export interface KnowledgeConceptContent {
  conceptId: string
  title: string
  itemType: KnowledgeItemType
  /** Length of the full document text, so the caller can tell when a slice is partial and page through it. */
  totalChars: number
  charStart: number
  charEnd: number
  content: string
  /** True when the returned slice was capped at {@link CONCEPT_READ_MAX_CHARS} and the document continues past `charEnd`. */
  truncated: boolean
}

/** One exact-pattern match within a concept's indexed text. */
export interface KnowledgeConceptGrepMatch {
  /** 1-based line number of the match start within the document text. */
  line: number
  charStart: number
  charEnd: number
  /** The matched text with a little surrounding context (see {@link CONCEPT_GREP_SNIPPET_PAD}). */
  snippet: string
}

/** Result of grepping a knowledge concept's indexed text for a regular expression. */
export interface KnowledgeConceptGrep {
  conceptId: string
  title: string
  itemType: KnowledgeItemType
  /** Total matches found in the document (may exceed `matches.length` when the cap was hit). */
  totalMatches: number
  matches: KnowledgeConceptGrepMatch[]
}

/**
 * One node of a knowledge base's organization tree, emitted in pre-order DFS so
 * the flat list reads top-down like an outline. `depth` (0 at the base root)
 * carries the hierarchy without a recursive shape. `conceptId` is set only for a
 * readable leaf (a completed file/url/note) so it can be passed to kb_read /
 * kb_grep; directories and not-yet-indexed leaves have none.
 */
export interface KnowledgeTreeNode {
  depth: number
  title: string
  itemType: KnowledgeItemType
  status: KnowledgeItemStatus
  conceptId?: string
}

/**
 * A knowledge base's organization tree — the logical groupId hierarchy of
 * knowledge_item (directories as folders, file/url/note as leaves), NOT the flat
 * physical `raw/` layout. The synthesized view OKF surfaces as an `index.md`.
 */
export interface KnowledgeOrganizationTree {
  baseId: string
  /**
   * Count of non-deleting items in the base. May exceed `nodes.length` for two reasons: the node
   * list hit the {@link KNOWLEDGE_TREE_MAX_NODES} cap, or a `maxDepth` filter dropped deeper items
   * (which are still counted here but not emitted as nodes).
   */
  totalItems: number
  /**
   * True only when the emitted node list was capped at {@link KNOWLEDGE_TREE_MAX_NODES} — it does
   * NOT flag `maxDepth` filtering. A reliable "whole tree returned" check is therefore
   * `truncated === false` AND no `maxDepth` was passed.
   */
  truncated: boolean
  nodes: KnowledgeTreeNode[]
}

/**
 * Result of a Concept ID-addressed mutation ({@link KnowledgeService.deleteConcepts} /
 * {@link KnowledgeService.refreshConcepts}). `applied` are the Concept IDs that resolved
 * to a visible document and were acted on; `notFound` are those that did not resolve in
 * this base (a no-op, reported back so the agent can re-check the id rather than assume success).
 */
export interface KnowledgeConceptMutationResult {
  applied: string[]
  notFound: string[]
}

/**
 * Concept ID (relative path, OKF §2) of a search hit's source document, or
 * undefined when it has none: a directory (no material), or a url/note whose
 * snapshot relativePath was not captured yet. A completed leaf normally has one,
 * so this only swallows the rare unindexed-snapshot case rather than throwing
 * out of the whole search.
 */
function deriveConceptId(item: KnowledgeItem): string | undefined {
  if (item.type === 'directory') {
    return undefined
  }
  try {
    return toMaterialRelativePath(item)
  } catch {
    return undefined
  }
}

/** Compile a kb_grep pattern (always global; case-insensitive unless told otherwise), turning a bad pattern into a validation error. */
function compileGrepRegex(pattern: string, ignoreCase: boolean): RegExp {
  try {
    return new RegExp(pattern, ignoreCase ? 'gi' : 'g')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw DataApiErrorFactory.validation({ pattern: [message] }, `Invalid kb_grep regular expression: ${message}`)
  }
}

/**
 * Scan `text` for every match of the global `regex`, returning the total count
 * and the first `limit` matches with 1-based line numbers and padded snippets.
 * Line numbers are tracked in a single forward pass (matches arrive in order);
 * `lastIndex` is advanced past zero-width matches so an empty-matching pattern
 * cannot spin. `regex` MUST carry the global flag (the caller compiles it so).
 */
function scanConceptMatches(
  text: string,
  regex: RegExp,
  limit: number
): { totalMatches: number; matches: KnowledgeConceptGrepMatch[] } {
  const matches: KnowledgeConceptGrepMatch[] = []
  let totalMatches = 0
  // Forward line cursor: `line` is the 1-based line at offset `lineScanIndex`.
  let line = 1
  let lineScanIndex = 0

  for (let result = regex.exec(text); result !== null; result = regex.exec(text)) {
    totalMatches++
    const start = result.index
    const end = start + result[0].length

    if (matches.length < limit) {
      // Count only the newlines in the gap since the previous match — O(n) total.
      for (; lineScanIndex < start; lineScanIndex++) {
        if (text[lineScanIndex] === '\n') line++
      }
      matches.push({
        line,
        charStart: start,
        charEnd: end,
        snippet: text.slice(
          Math.max(0, start - CONCEPT_GREP_SNIPPET_PAD),
          Math.min(text.length, end + CONCEPT_GREP_SNIPPET_PAD)
        )
      })
    }

    // Zero-width match: bump lastIndex so exec() advances past the same position.
    regex.lastIndex = end > start ? end : end + 1
  }

  return { totalMatches, matches }
}

@Injectable('KnowledgeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['KnowledgeVectorStoreService', 'JobManager', 'FileProcessingService'])
export class KnowledgeService extends BaseService {
  private readonly knowledgeLockManager = new KnowledgeLockManager()
  private readonly workflowService = new KnowledgeWorkflowService(this.knowledgeLockManager)

  protected onInit(): void {
    const jobManager = application.get('JobManager')
    jobManager.registerHandler(
      'knowledge.prepare-root',
      createPrepareRootJobHandler(this.knowledgeLockManager, this.workflowService)
    )
    jobManager.registerHandler('knowledge.index-documents', createIndexDocumentsJobHandler(this.knowledgeLockManager))
    jobManager.registerHandler(
      'knowledge.check-file-processing-result',
      createCheckFileProcessingResultJobHandler(this.knowledgeLockManager, this.workflowService)
    )
    jobManager.registerHandler('knowledge.delete-subtree', createDeleteSubtreeJobHandler(this.knowledgeLockManager))
    jobManager.registerHandler(
      'knowledge.reindex-subtree',
      createReindexSubtreeJobHandler(this.knowledgeLockManager, this.workflowService)
    )
  }

  protected async onAllReady(): Promise<void> {
    await this.recoverDeletingItems()
    await this.recoverInterruptedItems()
  }

  async createBase(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const base = await knowledgeBaseService.create(dto)
    const vectorStoreService = application.get('KnowledgeVectorStoreService')

    try {
      await vectorStoreService.getIndexStore(base)
    } catch (error) {
      await this.rollbackFailedBaseCreation(base.id)
      throw error
    }

    return base
  }

  /**
   * Undo a half-created base after its index store failed to open: remove the
   * orphaned `.cherry/` directory `getIndexStore` left on disk and drop the DB
   * row. Both steps are best-effort and logged — a cleanup failure must never
   * mask the original open error the caller needs to see.
   */
  private async rollbackFailedBaseCreation(baseId: string): Promise<void> {
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    try {
      await vectorStoreService.deleteStore(baseId)
    } catch (cleanupError) {
      logger.warn('Failed to remove index store dir during createBase rollback', cleanupError as Error, { baseId })
    }
    try {
      await knowledgeBaseService.delete(baseId)
    } catch (cleanupError) {
      logger.warn('Failed to delete knowledge base row during createBase rollback', cleanupError as Error, { baseId })
    }
  }

  async deleteBase(baseId: string): Promise<void> {
    await this.cancelAllJobsForBase(baseId)

    await this.knowledgeLockManager.withBaseMutationLock(baseId, async () => {
      try {
        const vectorStoreService = application.get('KnowledgeVectorStoreService')
        await vectorStoreService.deleteStore(baseId)
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to delete knowledge base vector artifacts', normalizedError, { baseId })
        throw error
      }

      try {
        await knowledgeBaseService.delete(baseId)
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to delete knowledge base SQLite row after artifact cleanup', normalizedError, {
          baseId
        })
        throw DataApiErrorFactory.invalidOperation(
          'deleteBase',
          `Vector artifacts were deleted, but SQLite knowledge base cleanup failed: ${normalizedError.message}`
        )
      }
    })
  }

  async restoreBase(dto: RestoreKnowledgeBaseDto): Promise<RestoreKnowledgeBaseResult> {
    const sourceBase = await knowledgeBaseService.getById(dto.sourceBaseId)

    const createDto: CreateKnowledgeBaseDto = {
      name: dto.name?.trim() ?? sourceBase.name,
      dimensions: dto.dimensions,
      embeddingModelId: dto.embeddingModelId,
      rerankModelId: sourceBase.rerankModelId,
      fileProcessorId: sourceBase.fileProcessorId,
      chunkSize: sourceBase.chunkSize,
      chunkOverlap: sourceBase.chunkOverlap,
      threshold: sourceBase.threshold,
      documentCount: sourceBase.documentCount,
      searchMode: sourceBase.searchMode,
      hybridAlpha: sourceBase.hybridAlpha,
      groupId: sourceBase.groupId ?? undefined
    }

    const rootItems = await knowledgeItemService.getRootItemsByBaseId(sourceBase.id)

    // Partial restore: probe each root's source and skip the ones whose source is genuinely gone, so
    // a single missing source no longer aborts the entire restore. This is the common case for a
    // failed base — a v1-migrated directory child has a virtual path with no raw/ file, and a file
    // whose original was deleted has no material to copy; addItems would throw on the first such
    // item and roll back the whole batch. An 'unverifiable' source (transient/permission error) is
    // kept, not skipped — like reindex, we never drop a source we could not confirm is gone.
    const restorableRootItems: KnowledgeItem[] = []
    for (const item of rootItems) {
      if ((await classifyKnowledgeItemSource(sourceBase.id, item)) === 'missing') {
        logger.warn('Skipping knowledge item with a missing source during restore', {
          sourceBaseId: sourceBase.id,
          itemId: item.id,
          type: item.type
        })
        continue
      }
      restorableRootItems.push(item)
    }
    const skippedMissingSourceCount = rootItems.length - restorableRootItems.length
    if (skippedMissingSourceCount > 0) {
      logger.info('Restore skipped knowledge items whose source no longer exists', {
        sourceBaseId: sourceBase.id,
        skippedMissingSourceCount,
        restorableCount: restorableRootItems.length
      })
    }

    const inputs = restorableRootItems.map((item) => this.toRestoreRuntimeInput(sourceBase.id, item))
    const restoredBase = await this.createBase(createDto)
    try {
      await this.addItems(restoredBase.id, inputs)
    } catch (error) {
      try {
        await this.deleteBase(restoredBase.id)
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        logger.error(
          'Failed to delete restored knowledge base after item restoration failed',
          cleanupError instanceof Error ? cleanupError : new Error(cleanupMessage),
          {
            sourceBaseId: sourceBase.id,
            restoredBaseId: restoredBase.id
          }
        )
        throw DataApiErrorFactory.invalidOperation(
          'restoreBase',
          `Failed to restore knowledge items: ${
            error instanceof Error ? error.message : String(error)
          }. Restored knowledge base '${restoredBase.id}' could not be cleaned up automatically: ${cleanupMessage}. Please delete it manually.`
        )
      }
      throw DataApiErrorFactory.invalidOperation(
        'restoreBase',
        `Failed to restore knowledge items: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    return { base: restoredBase, skippedMissingSourceCount }
  }

  async addItems(
    baseId: string,
    items: KnowledgeAddItemInput[],
    conflictStrategy?: KnowledgeAddConflictStrategy
  ): Promise<KnowledgeAddItemsResult> {
    await this.assertBaseCanRunRuntimeOperation(baseId, 'addItems')
    return await this.workflowService.addItems(baseId, items, conflictStrategy)
  }

  async deleteItems(baseId: string, itemIds: string[]): Promise<void> {
    const rootItemIds = await knowledgeItemService.getOutermostSelectedItemIds(baseId, itemIds)
    if (rootItemIds.length === 0) {
      return
    }

    await this.workflowService.deleteItems(baseId, rootItemIds)
  }

  async reindexItems(baseId: string, itemIds: string[]): Promise<void> {
    await this.assertBaseCanRunRuntimeOperation(baseId, 'reindexItems')
    const rootItemIds = await knowledgeItemService.getOutermostSelectedItemIds(baseId, itemIds)
    if (rootItemIds.length === 0) {
      return
    }

    await this.assertSubtreesCanReindex(baseId, rootItemIds)

    await this.workflowService.reindexItems(baseId, rootItemIds)
  }

  async listBases(): Promise<KnowledgeBase[]> {
    const { items } = await knowledgeBaseService.list({ page: 1, limit: KNOWLEDGE_BASES_MAX_LIMIT })
    return items
  }

  async listRootItems(baseId: string): Promise<KnowledgeItem[]> {
    return await knowledgeItemService.getRootItemsByBaseId(baseId)
  }

  @TraceMethod({ spanName: 'Knowledge.search', tag: 'Knowledge' })
  async search(baseId: string, query: string): Promise<KnowledgeSearchResult[]> {
    await this.assertBaseCanRunRuntimeOperation(baseId, 'search')

    if (!SEARCH_TOKEN_PATTERN.test(query)) {
      throw DataApiErrorFactory.validation(
        { query: ['Query has no searchable tokens'] },
        'Query has no searchable tokens'
      )
    }

    const base = await knowledgeBaseService.getById(baseId)
    // Stored search mode and the index store's mode are the same enum now, so no mapping.
    const mode = base.searchMode
    // BM25 is lexical only; skip the embedding round-trip when the query won't use it.
    const queryEmbedding = mode === 'bm25' ? undefined : await embedKnowledgeQuery(base, query)

    const resolvedTopK = base.documentCount ?? 10
    const candidateLimit = Math.min(resolvedTopK * KNOWLEDGE_SEARCH_OVERFETCH_FACTOR, KNOWLEDGE_SEARCH_CANDIDATE_CAP)

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = await vectorStoreService.getIndexStore(base)
    const matches = await this.runStoreOperation(store, baseId, 'search', () =>
      store.search({
        queryText: query,
        queryEmbedding,
        mode,
        topK: candidateLimit,
        alpha: base.hybridAlpha
      })
    )

    const scoreKind = getInitialSearchScoreKind(base)
    const visibleSearchResults = await this.toVisibleSearchResults(baseId, matches, scoreKind)
    const topResults = this.trimToTopK(visibleSearchResults, resolvedTopK, baseId)

    if (base.rerankModelId) {
      const rerankedResults = await rerankKnowledgeSearchResults(base, query, topResults)
      return withSearchRanks(applyRelevanceThreshold(rerankedResults, base.threshold))
    }

    return withSearchRanks(applyRelevanceThreshold(topResults, base.threshold))
  }

  async listItemChunks(baseId: string, itemId: string): Promise<KnowledgeItemChunk[]> {
    const knowledgeBaseId = toKnowledgeBaseId(baseId)
    const knowledgeItemId = toKnowledgeItemId(itemId)
    await this.assertBaseCanRunRuntimeOperation(knowledgeBaseId, 'listItemChunks')
    const item = await this.assertItemCanRunChunkOperation(knowledgeBaseId, knowledgeItemId, 'list chunks')
    await this.assertCompletedContainerHasNoDeletingChildren(knowledgeBaseId, item)

    const base = await knowledgeBaseService.getById(knowledgeBaseId)
    const leafItems = await knowledgeItemService.getSubtreeItems(knowledgeBaseId, [knowledgeItemId], {
      includeRoots: true,
      leafOnly: true
    })
    if (leafItems.length === 0) {
      return []
    }

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = await vectorStoreService.getIndexStore(base)
    const chunkGroups = await this.runStoreOperation(store, knowledgeBaseId, 'listItemChunks', () =>
      Promise.all(
        leafItems.map(async (leafItem) => {
          const units = await store.listMaterialUnits(leafItem.id)
          return units.map(
            (unit): KnowledgeItemChunk => ({
              id: unit.unitId,
              itemId: leafItem.id,
              content: unit.text,
              metadata: {
                itemId: leafItem.id,
                itemType: leafItem.type,
                source: leafItem.data.source,
                chunkIndex: unit.unitIndex,
                tokenCount: estimateTokenCount(unit.text)
              }
            })
          )
        })
      )
    )

    return chunkGroups.flat()
  }

  /**
   * Read a knowledge concept's indexed text by its Concept ID (the material's
   * relative path, OKF §2), optionally a `[charStart, charEnd)` slice. The slice
   * is capped at {@link CONCEPT_READ_MAX_CHARS}; `totalChars` + `truncated` let
   * the caller page through a longer document. Throws NOT_FOUND when the Concept
   * ID does not resolve to a readable, visible document in this base.
   */
  async readConcept(
    baseId: string,
    conceptId: string,
    range?: { charStart?: number; charEnd?: number }
  ): Promise<KnowledgeConceptContent> {
    const { item, text } = await this.resolveConcept(baseId, conceptId, 'readConcept')

    const totalChars = text.length
    const start = Math.min(Math.max(range?.charStart ?? 0, 0), totalChars)
    // Where the caller would have ended without the cap (an omitted charEnd reads to the document end).
    const naturalEnd = Math.min(range?.charEnd ?? totalChars, totalChars)
    const end = Math.max(start, Math.min(naturalEnd, start + CONCEPT_READ_MAX_CHARS))

    return {
      conceptId,
      title: getKnowledgeItemDisplayTitle(item),
      itemType: item.type,
      totalChars,
      charStart: start,
      charEnd: end,
      content: text.slice(start, end),
      truncated: end < naturalEnd
    }
  }

  /**
   * Search a knowledge concept's indexed text for a regular expression, returning
   * the total match count and the first `maxMatches` matches (line, offsets, a
   * padded snippet). The pattern is compiled global, case-insensitive by default;
   * an invalid pattern throws a validation error. Throws NOT_FOUND when the
   * Concept ID does not resolve to a readable, visible document in this base.
   */
  async grepConcept(
    baseId: string,
    conceptId: string,
    options: { pattern: string; ignoreCase?: boolean; maxMatches?: number }
  ): Promise<KnowledgeConceptGrep> {
    const { item, text } = await this.resolveConcept(baseId, conceptId, 'grepConcept')

    const limit = Math.min(
      Math.max(options.maxMatches ?? CONCEPT_GREP_DEFAULT_MAX_MATCHES, 1),
      CONCEPT_GREP_MAX_MATCHES
    )
    const regex = compileGrepRegex(options.pattern, options.ignoreCase ?? true)
    const { totalMatches, matches } = scanConceptMatches(text, regex, limit)

    return {
      conceptId,
      title: getKnowledgeItemDisplayTitle(item),
      itemType: item.type,
      totalMatches,
      matches
    }
  }

  /**
   * Delete knowledge documents addressed by Concept ID (the deep-read/kb_manage
   * write counterpart to {@link readConcept}). Each Concept ID is resolved to its
   * knowledge item and deleted via {@link deleteItems} (which expands to the
   * outermost selected subtree); an id that does not resolve to a visible document
   * in this base is reported in `notFound` rather than failing the whole batch.
   */
  async deleteConcepts(baseId: string, conceptIds: string[]): Promise<KnowledgeConceptMutationResult> {
    const { found, notFound } = await this.resolveConceptItemIds(baseId, conceptIds, 'deleteConcepts')
    if (found.length > 0) {
      await this.deleteItems(
        baseId,
        found.map((entry) => entry.itemId)
      )
    }
    return { applied: found.map((entry) => entry.conceptId), notFound }
  }

  /**
   * Re-index knowledge documents addressed by Concept ID. Each Concept ID is
   * resolved to its knowledge item and re-indexed via {@link reindexItems}; an id
   * that does not resolve to a visible document in this base is reported in
   * `notFound` rather than failing the whole batch.
   */
  async refreshConcepts(baseId: string, conceptIds: string[]): Promise<KnowledgeConceptMutationResult> {
    const { found, notFound } = await this.resolveConceptItemIds(baseId, conceptIds, 'refreshConcepts')
    if (found.length > 0) {
      await this.reindexItems(
        baseId,
        found.map((entry) => entry.itemId)
      )
    }
    return { applied: found.map((entry) => entry.conceptId), notFound }
  }

  /**
   * Resolve a batch of Concept IDs to their knowledge item ids for a Concept
   * ID-addressed mutation. Mirrors {@link resolveConcept}'s identity boundary —
   * each relative path is looked up in this base's index store, then re-validated
   * against the visible knowledge_item (same base, completed) — but resolves many
   * ids and partitions them into resolved (`found`) vs unresolved (`notFound`)
   * instead of throwing, so one bad id does not sink the batch. Duplicate ids in
   * the input are collapsed to a single resolution.
   */
  private async resolveConceptItemIds(
    baseId: string,
    conceptIds: string[],
    operation: string
  ): Promise<{ found: Array<{ conceptId: string; itemId: string }>; notFound: string[] }> {
    const base = await knowledgeBaseService.getById(baseId)
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = await vectorStoreService.getIndexStore(base)

    const found: Array<{ conceptId: string; itemId: string }> = []
    const notFound: string[] = []
    const seen = new Set<string>()

    for (const conceptId of conceptIds) {
      if (seen.has(conceptId)) {
        continue
      }
      seen.add(conceptId)

      const ref = await this.runStoreOperation(store, baseId, operation, () =>
        store.getMaterialByRelativePath(conceptId)
      )
      // Identity re-check: the resolved material id must still be a visible item in this base.
      const item = ref ? (await this.loadVisibleItems(baseId, [ref.materialId])).get(ref.materialId) : undefined
      if (ref && item) {
        found.push({ conceptId, itemId: ref.materialId })
      } else {
        notFound.push(conceptId)
      }
    }

    return { found, notFound }
  }

  /**
   * Resolve a Concept ID to its content text for the deep-read tools. The tools
   * address by relative path (a transparent DB key, never an fs path), so this
   * re-validates the resolved material against the visible knowledge_item (same
   * base, completed) before returning any text — the identity boundary that keeps
   * a relative path from reaching another base's or a deleted item's content.
   * Throws NOT_FOUND when the concept does not resolve to a readable, visible document.
   */
  private async resolveConcept(
    baseId: string,
    conceptId: string,
    operation: string
  ): Promise<{ item: KnowledgeItem; text: string }> {
    await this.assertBaseCanRunRuntimeOperation(baseId, operation)

    const base = await knowledgeBaseService.getById(baseId)
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = await vectorStoreService.getIndexStore(base)

    const ref = await this.runStoreOperation(store, baseId, operation, () => store.getMaterialByRelativePath(conceptId))
    if (!ref) {
      throw DataApiErrorFactory.notFound('Knowledge concept', conceptId)
    }

    const item = (await this.loadVisibleItems(baseId, [ref.materialId])).get(ref.materialId)
    if (!item) {
      throw DataApiErrorFactory.notFound('Knowledge concept', conceptId)
    }

    const text = await this.runStoreOperation(store, baseId, operation, () => store.readMaterialContent(ref.materialId))
    if (text == null) {
      throw DataApiErrorFactory.notFound('Knowledge concept', conceptId)
    }

    return { item, text }
  }

  /**
   * Build a knowledge base's organization tree from the `knowledge_item.groupId`
   * hierarchy — directories are folders, file/url/note are leaves carrying a
   * readable `conceptId` (when completed) for kb_read / kb_grep. This is the
   * logical org layer the OKF `index.md` surfaces, deliberately decoupled from
   * the flat physical `raw/` layout: no material scan, no path joins. Emitted as
   * a pre-order DFS node list (each node's `depth` carries the hierarchy),
   * capped at {@link KNOWLEDGE_TREE_MAX_NODES}. Throws NOT_FOUND if the base does
   * not exist; available regardless of the base's runtime (search) state.
   */
  async getOrganizationTree(baseId: string, options: { maxDepth?: number } = {}): Promise<KnowledgeOrganizationTree> {
    await knowledgeBaseService.getById(baseId)

    const items = await knowledgeItemService.getItemsByBaseId(baseId)

    // Index children by their parent groupId (null = base root); each bucket keeps
    // getItemsByBaseId's createdAt/id order, so siblings emit in a stable order.
    const childrenByGroupId = new Map<string | null, KnowledgeItem[]>()
    for (const item of items) {
      const key = item.groupId ?? null
      const bucket = childrenByGroupId.get(key)
      if (bucket) {
        bucket.push(item)
      } else {
        childrenByGroupId.set(key, [item])
      }
    }

    const maxDepth = options.maxDepth
    const nodes: KnowledgeTreeNode[] = []
    let truncated = false

    const walk = (groupId: string | null, depth: number): void => {
      if (truncated || (maxDepth !== undefined && depth > maxDepth)) {
        return
      }
      for (const item of childrenByGroupId.get(groupId) ?? []) {
        if (nodes.length >= KNOWLEDGE_TREE_MAX_NODES) {
          truncated = true
          return
        }
        nodes.push({
          depth,
          title: getKnowledgeItemDisplayTitle(item),
          itemType: item.type,
          status: item.status,
          // Only a completed leaf is readable; directories and pending leaves carry no Concept ID.
          conceptId: item.type !== 'directory' && item.status === 'completed' ? deriveConceptId(item) : undefined
        })
        if (item.type === 'directory') {
          walk(item.id, depth + 1)
        }
      }
    }

    walk(null, 0)

    return { baseId, totalItems: items.length, truncated, nodes }
  }

  /**
   * Turn raw index matches into visible search results: fetch each match's
   * knowledge item once, drop any that is missing, in another base, or not
   * completed, and reconstruct the chunk metadata (item type / source from the
   * item; chunk index from the unit; token count recomputed from the body).
   */
  private async toVisibleSearchResults(
    baseId: string,
    matches: KnowledgeIndexSearchMatch[],
    scoreKind: KnowledgeSearchResult['scoreKind']
  ): Promise<KnowledgeSearchResult[]> {
    const itemsById = await this.loadVisibleItems(
      baseId,
      matches.map((match) => match.materialId)
    )

    const results: KnowledgeSearchResult[] = []
    for (const match of matches) {
      const item = itemsById.get(match.materialId)
      if (!item) {
        continue
      }
      results.push({
        pageContent: match.text,
        score: match.score,
        scoreKind,
        rank: results.length + 1,
        metadata: {
          itemId: match.materialId,
          itemType: item.type,
          source: item.data.source,
          chunkIndex: match.unitIndex,
          tokenCount: estimateTokenCount(match.text)
        },
        itemId: match.materialId,
        chunkId: match.unitId,
        // Concept ID + title so a hit can be followed up with kb_read / kb_grep.
        conceptId: deriveConceptId(item),
        title: getKnowledgeItemDisplayTitle(item)
      })
    }
    return results
  }

  /** Keep the highest-scored `topK` visible results, discarding the over-fetched tail. */
  private trimToTopK(results: KnowledgeSearchResult[], topK: number, baseId: string): KnowledgeSearchResult[] {
    if (results.length <= topK) {
      return results
    }
    logger.debug('Trimmed over-fetched knowledge search results to topK', {
      baseId,
      visibleCandidates: results.length,
      topK
    })
    return results.slice(0, topK)
  }

  /** Fetch the distinct items behind the matches, keeping only those visible in this base (same base, completed). */
  private async loadVisibleItems(baseId: string, materialIds: string[]): Promise<Map<string, KnowledgeItem>> {
    const uniqueIds = [...new Set(materialIds)]
    const visibleItems = new Map<string, KnowledgeItem>()

    await Promise.all(
      uniqueIds.map(async (materialId) => {
        try {
          const item = await knowledgeItemService.getById(materialId)
          if (item.baseId === baseId && item.status === 'completed') {
            visibleItems.set(materialId, item)
          }
        } catch (error) {
          if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
            return
          }
          throw error
        }
      })
    )

    return visibleItems
  }

  /**
   * Run a per-base index-store interaction, translating the error raised when the
   * store is closed mid-flight — a concurrent {@link deleteBase} or app shutdown
   * closed the driver — into a defined, retryable DataApiError instead of leaking
   * the opaque driver-level error to the renderer. Genuine query errors rethrow
   * unchanged.
   */
  private async runStoreOperation<T>(
    store: KnowledgeIndexStore,
    baseId: string,
    operation: string,
    run: () => Promise<T>
  ): Promise<T> {
    try {
      return await run()
    } catch (error) {
      if (store.isClosed()) {
        logger.warn('Knowledge index store was closed during operation', { baseId, operation })
        throw DataApiErrorFactory.invalidOperation(
          operation,
          `Knowledge base '${baseId}' index store was closed during ${operation}; retry the operation`
        )
      }
      throw error
    }
  }

  private async cancelAllJobsForBase(baseId: string): Promise<void> {
    const jobManager = application.get('JobManager')
    const activeJobs = await jobManager.list({
      queue: knowledgeQueueName(toKnowledgeBaseId(baseId)),
      status: [...KNOWLEDGE_ACTIVE_JOB_STATUSES],
      limit: KNOWLEDGE_ACTIVE_JOB_LIMIT
    })
    const jobsToCancel = activeJobs.filter((job) => KNOWLEDGE_JOB_TYPE_SET.has(job.type))
    const linkedFileProcessingJobIds = activeJobs.flatMap((job) => {
      const narrowed = narrowKnowledgeJobInput(job)
      return narrowed?.type === 'knowledge.check-file-processing-result' ? [narrowed.input.fileProcessingJobId] : []
    })

    await Promise.all([
      ...jobsToCancel.map((job) => jobManager.cancel(job.id, 'delete-base')),
      ...linkedFileProcessingJobIds.map((jobId) => jobManager.cancel(jobId, 'delete-base'))
    ])
  }

  /**
   * Park items stranded mid-indexing by an app quit / restart at `failed`.
   *
   * Indexing handlers declare `recovery: 'abandon'`, so an interrupted job is
   * cancelled rather than silently resumed on the next launch — a deliberate
   * quit must not auto-spend the (paid) embedding API. The job side is handled
   * by JobManager's startup recovery; this closes the item side. The common case
   * (handler settled the abort as cancelled) is already flipped to `failed` by
   * the job's onSettled; this is the boot-time safety net for the stragglers
   * onSettled lost the race to write (process exited first) or never ran (hard
   * kill / crash). Marking them `failed` clears the perpetual spinner and makes
   * them reindexable so the user can finish them on demand.
   */
  private async recoverInterruptedItems(): Promise<void> {
    try {
      const failedCount = await knowledgeItemService.failInterruptedItems(KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED)
      if (failedCount > 0) {
        logger.info('Recovered interrupted knowledge items', { count: failedCount })
      }
    } catch (error) {
      logger.error('Failed to recover interrupted knowledge items', error as Error)
    }
  }

  private async recoverDeletingItems(): Promise<void> {
    let deletingRootGroups: Awaited<ReturnType<typeof knowledgeItemService.getDeletingRootGroups>>
    try {
      deletingRootGroups = await knowledgeItemService.getDeletingRootGroups()
    } catch (error) {
      logger.error('Failed to scan deleting knowledge items for recovery', error as Error)
      return
    }

    if (deletingRootGroups.length === 0) {
      return
    }

    const jobManager = application.get('JobManager')
    for (const { baseId, rootItemIds } of deletingRootGroups) {
      for (let i = 0; i < rootItemIds.length; i += DELETE_RECOVERY_ROOT_CHUNK_SIZE) {
        const rootItemIdChunk = rootItemIds.slice(i, i + DELETE_RECOVERY_ROOT_CHUNK_SIZE)
        try {
          await jobManager.enqueue(
            'knowledge.delete-subtree',
            { baseId, rootItemIds: rootItemIdChunk },
            {
              idempotencyKey: knowledgeDeleteSubtreeIdempotencyKey(
                toKnowledgeBaseId(baseId),
                toKnowledgeItemIds(rootItemIdChunk)
              ),
              queue: knowledgeQueueName(toKnowledgeBaseId(baseId))
            }
          )
        } catch (error) {
          logger.error('Failed to enqueue recovered knowledge delete cleanup', error as Error, {
            baseId,
            rootItemIds: rootItemIdChunk
          })
        }
      }
    }
  }

  private async assertBaseCanRunRuntimeOperation(baseId: string, operation: string): Promise<void> {
    const base = await knowledgeBaseService.getById(baseId)

    if (base.status !== 'failed') {
      return
    }

    throw DataApiErrorFactory.validation(
      {
        base: [`Knowledge base '${baseId}' is in failed state; restore it before ${operation}.`]
      },
      `Cannot ${operation} failed knowledge base`
    )
  }

  private async getRootItemsInBase(baseId: string, itemIds: string[]): Promise<KnowledgeItem[]> {
    const rootIds = [...new Set(itemIds)]
    const items = await Promise.all(rootIds.map((itemId) => knowledgeItemService.getById(itemId)))
    const invalidItem = items.find((item) => item.baseId !== baseId)

    if (invalidItem) {
      throw new Error(`Knowledge item '${invalidItem.id}' does not belong to base '${baseId}'`)
    }

    return items
  }

  private async assertItemCanRunChunkOperation(
    baseId: string,
    itemId: string,
    operation: 'list chunks' | 'delete chunk'
  ): Promise<KnowledgeItem> {
    const [item] = await this.getRootItemsInBase(baseId, [itemId])

    if (item.status !== 'completed') {
      throw DataApiErrorFactory.validation(
        { item: [`Knowledge item '${itemId}' must be completed before ${operation}`] },
        `Cannot ${operation} for a non-completed knowledge item`
      )
    }

    return item
  }

  private async assertCompletedContainerHasNoDeletingChildren(baseId: string, item: KnowledgeItem): Promise<void> {
    if (item.type !== 'directory') {
      return
    }

    const subtreeItems = await knowledgeItemService.getSubtreeItems(baseId, [item.id])
    if (subtreeItems.some((item) => item.status === 'deleting')) {
      throw DataApiErrorFactory.validation(
        { item: [`Knowledge item subtree '${item.id}' is being deleted`] },
        'Cannot list chunks for a deleting knowledge item'
      )
    }
  }

  private async assertSubtreesCanReindex(baseId: string, rootItemIds: string[]): Promise<void> {
    const blockingStatusCounts = new Map<KnowledgeItemStatus, number>()
    const missingSourceItemIds: string[] = []
    const unverifiableSourceItemIds: string[] = []

    for (const rootItemId of rootItemIds) {
      const subtreeItems = await knowledgeItemService.getSubtreeItems(baseId, [rootItemId], { includeRoots: true })

      // Reindex deletes the subtree's vectors before re-reading the source (reindexSubtreeJobHandler),
      // so a root whose source is gone would lose its vectors with nothing to rebuild from — reject up
      // front. Only the root's own source matters: a directory is rescanned from data.source and its
      // children recreated (never read from their raw/ files), a file leaf reads its own raw/ file, and
      // note/url always rebuild from the DB / network. A v1-migrated folder child reindexed on its own
      // is a file root whose raw/ file never existed, so this rejects it too. Distinguish a genuinely
      // missing source (delete-and-re-add) from one we could not verify (transient/permission error,
      // which should retry rather than be destroyed).
      const root = subtreeItems.find((item) => item.id === rootItemId)
      if (root) {
        const sourceState = await classifyKnowledgeItemSource(baseId, root)
        if (sourceState === 'missing') {
          missingSourceItemIds.push(rootItemId)
        } else if (sourceState === 'unverifiable') {
          unverifiableSourceItemIds.push(rootItemId)
        }
      }

      for (const item of subtreeItems) {
        if (REINDEX_ALLOWED_STATUSES.has(item.status)) {
          continue
        }

        blockingStatusCounts.set(item.status, (blockingStatusCounts.get(item.status) ?? 0) + 1)
      }
    }

    if (missingSourceItemIds.length > 0) {
      throw DataApiErrorFactory.validation(
        {
          item: [`Knowledge item source no longer exists on disk for ${missingSourceItemIds.length} item(s)`]
        },
        'Cannot reindex a knowledge item whose source file or folder no longer exists; delete it and add it again to rebuild'
      )
    }

    if (unverifiableSourceItemIds.length > 0) {
      throw DataApiErrorFactory.validation(
        {
          item: [`Could not verify the knowledge item source on disk for ${unverifiableSourceItemIds.length} item(s)`]
        },
        'Could not verify the knowledge item source (it may be temporarily unavailable); please try again'
      )
    }

    if (blockingStatusCounts.size === 0) {
      return
    }

    const statusSummary = [...blockingStatusCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `${status}=${count}`)
      .join(', ')

    throw DataApiErrorFactory.validation(
      {
        item: [`Knowledge item subtree is still running or being deleted: ${statusSummary}`]
      },
      'Cannot reindex knowledge item until the entire subtree is completed or failed'
    )
  }

  private toRestoreRuntimeInput(sourceBaseId: string, item: KnowledgeItem): KnowledgeAddItemInput {
    try {
      if (item.type === 'file') {
        return KnowledgeAddItemInputSchema.parse({
          type: 'file',
          data: {
            source: item.data.source,
            path: getKnowledgeBaseFilePath(sourceBaseId, item.data.relativePath),
            // Carry the processed artifact across so the new base indexes from it
            // instead of re-running the (slow, paid) file processor.
            ...(item.data.indexedRelativePath
              ? { indexedPath: getKnowledgeBaseFilePath(sourceBaseId, item.data.indexedRelativePath) }
              : {})
          }
        })
      }

      if (item.type === 'url') {
        return KnowledgeAddItemInputSchema.parse({
          type: 'url',
          data: {
            source: item.data.source,
            url: item.data.url,
            // Carry the captured snapshot across so the restored URL indexes offline
            // instead of re-fetching the live page (which may have changed or died).
            // If the source never captured one, omit it and let the first index capture.
            ...(item.data.relativePath
              ? { snapshotPath: getKnowledgeBaseFilePath(sourceBaseId, item.data.relativePath) }
              : {})
          }
        })
      }

      if (item.type === 'note') {
        return KnowledgeAddItemInputSchema.parse({
          type: 'note',
          // The snapshot relativePath is intentionally dropped: the content is the
          // source of truth and re-capturing it into the new base on first index is
          // free and deterministic, so there is no snapshot file to carry across.
          data: { source: item.data.source, content: item.data.content }
        })
      }

      return KnowledgeAddItemInputSchema.parse({
        type: item.type,
        data: item.data
      })
    } catch (error) {
      throw DataApiErrorFactory.invalidOperation(
        'restoreBase',
        `Cannot restore knowledge item '${item.id}' (${item.type}): ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
}
