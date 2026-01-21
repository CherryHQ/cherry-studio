import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT } from '@renderer/config/constant'
import { getModel } from '@renderer/hooks/useModel'
import i18n from '@renderer/i18n'
import { getKnowledgeBaseParams, getKnowledgeSourceUrl, searchKnowledgeBase } from '@renderer/services/KnowledgeService'
import type { KnowledgeBase, KnowledgeItem, KnowledgeReference, Model, WebSearchProviderResult } from '@renderer/types'
import { removeSpecialCharactersForFileName, uuid } from '@renderer/utils'
import { consolidateReferencesByUrl, selectReferences } from '@renderer/utils/webSearch'

import type { CompressionContext, ICompressionStrategy } from '../interfaces'

const logger = loggerService.withContext('RagCompressionStrategy')

export class RagCompressionStrategy implements ICompressionStrategy {
  readonly name = 'rag'

  async compress(results: WebSearchProviderResult[], context: CompressionContext): Promise<WebSearchProviderResult[]> {
    const { questions, requestId } = context

    const [embeddingModelId, embeddingProviderId, embeddingDimensions, documentCount, rerankModelId, rerankProviderId] =
      await Promise.all([
        preferenceService.get('chat.websearch.compression.rag_embedding_model_id'),
        preferenceService.get('chat.websearch.compression.rag_embedding_provider_id'),
        preferenceService.get('chat.websearch.compression.rag_embedding_dimensions'),
        preferenceService.get('chat.websearch.compression.rag_document_count'),
        preferenceService.get('chat.websearch.compression.rag_rerank_model_id'),
        preferenceService.get('chat.websearch.compression.rag_rerank_provider_id')
      ])

    const embeddingModel =
      embeddingModelId && embeddingProviderId ? getModel(embeddingModelId, embeddingProviderId) : undefined
    const rerankModel = rerankModelId && rerankProviderId ? getModel(rerankModelId, rerankProviderId) : undefined

    if (!embeddingModel) {
      throw new Error('Embedding model is required for RAG compression')
    }

    const totalDocumentCount = Math.max(0, results.length) * (documentCount ?? DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT)
    const searchBase = await this.ensureSearchBase(
      embeddingModel,
      embeddingDimensions,
      rerankModel,
      totalDocumentCount,
      requestId
    )

    try {
      const baseParams = getKnowledgeBaseParams(searchBase)
      await window.api.knowledgeBase.reset(baseParams)

      for (const result of results) {
        const item: KnowledgeItem & { sourceUrl?: string } = {
          id: uuid(),
          type: 'note',
          content: result.content,
          sourceUrl: result.url,
          created_at: Date.now(),
          updated_at: Date.now(),
          processingStatus: 'pending'
        }
        await window.api.knowledgeBase.add({ base: getKnowledgeBaseParams(searchBase), item })
      }

      const references = await this.querySearchBase(questions, searchBase)
      const selectedReferences = selectReferences(results, references, totalDocumentCount)

      logger.verbose('With RAG, the number of search results:', {
        raw: results.length,
        retrieved: references.length,
        selected: selectedReferences.length
      })

      return consolidateReferencesByUrl(results, selectedReferences)
    } finally {
      await this.cleanupSearchBase(searchBase)
    }
  }

  private async ensureSearchBase(
    embeddingModel: Model,
    embeddingDimensions: number | null | undefined,
    rerankModel: Model | undefined,
    documentCount: number,
    requestId: string
  ): Promise<KnowledgeBase> {
    const baseId = `websearch-compression-${requestId}`
    const searchBase: KnowledgeBase = {
      id: baseId,
      name: `WebSearch-RAG-${requestId}`,
      model: embeddingModel,
      rerankModel: rerankModel,
      dimensions: embeddingDimensions ?? undefined,
      documentCount,
      items: [],
      created_at: Date.now(),
      updated_at: Date.now(),
      version: 1
    }

    const baseParams = getKnowledgeBaseParams(searchBase)
    await window.api.knowledgeBase.create(baseParams)
    return searchBase
  }

  private async cleanupSearchBase(searchBase: KnowledgeBase): Promise<void> {
    try {
      await window.api.knowledgeBase.delete(removeSpecialCharactersForFileName(searchBase.id))
      logger.debug(`Cleaned up search base: ${searchBase.id}`)
    } catch (error) {
      logger.warn(`Failed to cleanup search base ${searchBase.id}:`, error as Error)
      window.toast.warning({
        timeout: 5000,
        title: i18n.t('settings.tool.websearch.compression.error.cleanup_failed')
      })
    }
  }

  private async querySearchBase(questions: string[], searchBase: KnowledgeBase): Promise<KnowledgeReference[]> {
    const searchPromises = questions.map((question) => searchKnowledgeBase(question, searchBase))
    const settledResults = await Promise.allSettled(searchPromises)

    const allResults: Awaited<ReturnType<typeof searchKnowledgeBase>>[] = []
    for (const result of settledResults) {
      if (result.status === 'fulfilled') {
        allResults.push(result.value)
      } else {
        logger.warn('Failed to search knowledge base for question:', { reason: result.reason })
      }
    }

    if (allResults.length === 0 && settledResults.length > 0) {
      throw new Error('All knowledge base searches failed')
    }

    const flatResults = allResults.flat().sort((a, b) => b.score - a.score)

    logger.debug(`Found ${flatResults.length} result(s) in search base related to question(s): `, questions)

    const seen = new Set<string>()
    const uniqueResults = flatResults.filter((item) => {
      if (seen.has(item.pageContent)) {
        return false
      }
      seen.add(item.pageContent)
      return true
    })

    logger.debug(`Found ${uniqueResults.length} unique result(s) from search base after sorting and deduplication`)

    return await Promise.all(
      uniqueResults.map(async (result, index) => ({
        id: index + 1,
        content: result.pageContent,
        sourceUrl: await getKnowledgeSourceUrl(result),
        type: 'url' as const
      }))
    )
  }
}
