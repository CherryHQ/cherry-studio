import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { TraceMethod } from '@mcp-trace/trace-core'
import { DataApiErrorFactory } from '@shared/data/api'
import type { KnowledgeItem, KnowledgeItemChunk, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { getKnowledgeItemDisplayTitle, isCompletedVectorKnowledgeBase } from '@shared/data/types/knowledge'
import { estimateTokenCount } from 'tokenx'

import { assertBaseCanRunRuntimeOperation } from '../base/baseGuards'
import { embedKnowledgeQuery } from '../pipeline/indexing/embed'
import { rerankKnowledgeSearchResults } from '../pipeline/indexing/rerank'
import { extractFtsTokens } from '../pipeline/vectorstore/indexStore/ftsQuery'
import type { KnowledgeIndexSearchMatch } from '../pipeline/vectorstore/indexStore/model'
import { toKnowledgeBaseId, toKnowledgeItemId } from '../types'
import { applyRelevanceThreshold, getInitialSearchScoreKind, withSearchRanks } from './search'
import { runStoreOperation } from './storeOperation'
import { deriveConceptId, loadVisibleItems } from './visibility'

const logger = loggerService.withContext('Knowledge:QueryService')
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
    const base = assertBaseCanRunRuntimeOperation(baseId, 'search')

    // Same tokenization the FTS layer uses: no token means no BM25 hit is even possible.
    if (extractFtsTokens(query).length === 0) {
      throw DataApiErrorFactory.validation(
        { query: ['Query has no searchable tokens'] },
        'Query has no searchable tokens'
      )
    }

    // Vector/hybrid retrieval needs an embedding model; a base without one is
    // BM25-only. This is a fixed runtime policy, not a stored preference — mode is
    // computed fresh every call, so it can never drift out of sync with the base.
    const mode = isCompletedVectorKnowledgeBase(base) ? 'hybrid' : 'bm25'
    // BM25 is lexical only; skip the embedding round-trip when the query won't use it.
    const queryEmbedding = mode === 'bm25' ? undefined : await embedKnowledgeQuery(base, query)

    const resolvedTopK = base.documentCount ?? 10
    const candidateLimit = Math.min(resolvedTopK * KNOWLEDGE_SEARCH_OVERFETCH_FACTOR, KNOWLEDGE_SEARCH_CANDIDATE_CAP)

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = vectorStoreService.getIndexStore(base)
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

    // Rerank before trimming so the reranker sees the full over-fetched candidate set and can
    // surface the best matches; without a rerank model this is a pass-through.
    const rerankedResults = await rerankKnowledgeSearchResults(base, query, visibleSearchResults)
    const topResults = this.trimToTopK(rerankedResults, resolvedTopK, baseId)
    return withSearchRanks(applyRelevanceThreshold(topResults, base.threshold))
  }

  async listItemChunks(baseId: string, itemId: string): Promise<KnowledgeItemChunk[]> {
    const knowledgeBaseId = toKnowledgeBaseId(baseId)
    const knowledgeItemId = toKnowledgeItemId(itemId)
    assertBaseCanRunRuntimeOperation(knowledgeBaseId, 'listItemChunks')
    const item = this.assertItemCanRunChunkOperation(knowledgeBaseId, knowledgeItemId)
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
    const store = vectorStoreService.getIndexStore(base)
    const chunkGroups = await runStoreOperation(store, knowledgeBaseId, 'listItemChunks', () =>
      leafItems.map((leafItem) => {
        const units = store.listMaterialUnits(leafItem.id)
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

  private assertItemCanRunChunkOperation(baseId: string, itemId: string): KnowledgeItem {
    const item = knowledgeItemService.getById(itemId)
    if (item.baseId !== baseId) {
      throw new Error(`Knowledge item '${itemId}' does not belong to base '${baseId}'`)
    }

    if (item.status !== 'completed') {
      throw DataApiErrorFactory.validation(
        { item: [`Knowledge item '${itemId}' must be completed before list chunks`] },
        'Cannot list chunks for a non-completed knowledge item'
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
