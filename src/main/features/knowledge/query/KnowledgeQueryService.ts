import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { TraceMethod } from '@mcp-trace/trace-core'
import { DataApiErrorFactory } from '@shared/data/api'
import type { KnowledgeItem, KnowledgeItemChunk, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { getKnowledgeItemDisplayTitle, isCompletedVectorKnowledgeBase } from '@shared/data/types/knowledge'
import { estimateTokenCount } from 'tokenx'

import { assertBaseCanRunRuntimeOperation } from '../base/guards'
import { embedKnowledgeQuery } from '../indexing/embed'
import { rerankKnowledgeSearchResults } from '../indexing/rerank'
import { toKnowledgeBaseId, toKnowledgeItemId } from '../types'
import type { KnowledgeIndexSearchMatch } from '../vectorstore/indexStore/model'
import { applyRelevanceThreshold, getInitialSearchScoreKind, withSearchRanks } from './search'
import { runStoreOperation } from './storeOperation'
import { deriveConceptId, loadVisibleItems } from './visibility'

const logger = loggerService.withContext('Knowledge:QueryService')
const SEARCH_TOKEN_PATTERN = /[\p{L}\p{N}_]+/u
/**
 * Fetch this many × the requested result count as index candidates. The index
 * store only filters by material state; the item-visibility filter (missing /
 * other-base / not-completed) runs afterwards in the caller and can drop matches,
 * so over-fetching keeps the final set from shrinking below topK.
 */
const KNOWLEDGE_SEARCH_OVERFETCH_FACTOR = 5
/** Hard ceiling on fetched candidates, bounding the brute-force vector scan and rerank cost regardless of topK. */
const KNOWLEDGE_SEARCH_CANDIDATE_CAP = 200

/** Read side of the knowledge feature: index search (with visibility filtering + rerank) and chunk/item listing. */
export class KnowledgeQueryService {
  @TraceMethod({ spanName: 'Knowledge.search', tag: 'Knowledge' })
  async search(baseId: string, query: string): Promise<KnowledgeSearchResult[]> {
    assertBaseCanRunRuntimeOperation(baseId, 'search')

    if (!SEARCH_TOKEN_PATTERN.test(query)) {
      throw DataApiErrorFactory.validation(
        { query: ['Query has no searchable tokens'] },
        'Query has no searchable tokens'
      )
    }

    const base = knowledgeBaseService.getById(baseId)
    // Vector/hybrid retrieval needs an embedding model; a base without one is
    // BM25-only. This is a fixed runtime policy, not a stored preference — mode is
    // computed fresh every call, so it can never drift out of sync with the base.
    const mode = isCompletedVectorKnowledgeBase(base) ? 'hybrid' : 'bm25'
    // BM25 is lexical only; skip the embedding round-trip when the query won't use it.
    const queryEmbedding = mode === 'bm25' ? undefined : await embedKnowledgeQuery(base, query)

    const resolvedTopK = base.documentCount ?? 10
    const candidateLimit = Math.min(resolvedTopK * KNOWLEDGE_SEARCH_OVERFETCH_FACTOR, KNOWLEDGE_SEARCH_CANDIDATE_CAP)

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = await vectorStoreService.getIndexStore(base)
    const matches = await runStoreOperation(store, baseId, 'search', () =>
      store.search({
        queryText: query,
        queryEmbedding,
        mode,
        topK: candidateLimit
      })
    )

    const scoreKind = getInitialSearchScoreKind(mode)
    const visibleSearchResults = this.toVisibleSearchResults(baseId, matches, scoreKind)

    if (base.rerankModelId) {
      const rerankedResults = await rerankKnowledgeSearchResults(base, query, visibleSearchResults)
      // We trim the results after the rerank here, so the reranker can actually do its job and surface the best matches.
      const topReranked = this.trimToTopK(rerankedResults, resolvedTopK, baseId)
      return withSearchRanks(applyRelevanceThreshold(topReranked, base.threshold))
    }

    // If we don't need to rerank, we can just trim the results right here.
    const topResults = this.trimToTopK(visibleSearchResults, resolvedTopK, baseId)
    return withSearchRanks(applyRelevanceThreshold(topResults, base.threshold))
  }

  async listItemChunks(baseId: string, itemId: string): Promise<KnowledgeItemChunk[]> {
    const knowledgeBaseId = toKnowledgeBaseId(baseId)
    const knowledgeItemId = toKnowledgeItemId(itemId)
    assertBaseCanRunRuntimeOperation(knowledgeBaseId, 'listItemChunks')
    const item = await this.assertItemCanRunChunkOperation(knowledgeBaseId, knowledgeItemId, 'list chunks')
    this.assertCompletedContainerHasNoDeletingChildren(knowledgeBaseId, item)

    const base = knowledgeBaseService.getById(knowledgeBaseId)
    const leafItems = knowledgeItemService.getSubtreeItems(knowledgeBaseId, [knowledgeItemId], {
      includeRoots: true,
      leafOnly: true
    })
    if (leafItems.length === 0) {
      return []
    }

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = await vectorStoreService.getIndexStore(base)
    const chunkGroups = await runStoreOperation(store, knowledgeBaseId, 'listItemChunks', () =>
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

  listRootItems(baseId: string): KnowledgeItem[] {
    return knowledgeItemService.getRootItemsByBaseId(baseId)
  }

  /**
   * Turn raw index matches into visible search results: fetch each match's
   * knowledge item once, drop any that is missing, in another base, or not
   * completed, and reconstruct the chunk metadata (item type / source from the
   * item; chunk index from the unit; token count recomputed from the body).
   */
  private toVisibleSearchResults(
    baseId: string,
    matches: KnowledgeIndexSearchMatch[],
    scoreKind: KnowledgeSearchResult['scoreKind']
  ): KnowledgeSearchResult[] {
    const itemsById = loadVisibleItems(
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
        // Concept ID + title so a hit can be followed up with kb_read.
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

  private assertCompletedContainerHasNoDeletingChildren(baseId: string, item: KnowledgeItem): void {
    if (item.type !== 'directory') {
      return
    }

    const subtreeItems = knowledgeItemService.getSubtreeItems(baseId, [item.id])
    if (subtreeItems.some((item) => item.status === 'deleting')) {
      throw DataApiErrorFactory.validation(
        { item: [`Knowledge item subtree '${item.id}' is being deleted`] },
        'Cannot list chunks for a deleting knowledge item'
      )
    }
  }
}
