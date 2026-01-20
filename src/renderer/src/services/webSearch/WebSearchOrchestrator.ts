import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import { addSpan, endSpan } from '@renderer/services/SpanManagerService'
import type { WebSearchProvider, WebSearchProviderResponse, WebSearchProviderResult } from '@renderer/types'
import { formatErrorMessage } from '@renderer/utils/error'
import type { ExtractResults } from '@renderer/utils/extract'
import { fetchWebContents } from '@renderer/utils/fetch'
import dayjs from 'dayjs'

import type { CompressionStrategyFactory } from './compression'
import type { IRequestStateManager, ISearchStatusTracker } from './interfaces'
import WebSearchEngineProvider from './providers/WebSearchEngineProvider'

const logger = loggerService.withContext('WebSearchOrchestrator')

export class WebSearchOrchestrator {
  constructor(
    private readonly requestStateManager: IRequestStateManager,
    private readonly statusTracker: ISearchStatusTracker,
    private readonly compressionFactory: CompressionStrategyFactory
  ) {}

  async processWebsearch(
    webSearchProvider: WebSearchProvider,
    extractResults: ExtractResults,
    requestId: string
  ): Promise<WebSearchProviderResponse> {
    await this.statusTracker.setStatus(requestId, { phase: 'default' })

    if (!extractResults.websearch?.question || extractResults.websearch.question.length === 0) {
      logger.info('No valid question found in extractResults.websearch')
      return { results: [] }
    }

    const signal = this.requestStateManager.getRequestState(requestId).signal || this.requestStateManager.getSignal()
    const questions = extractResults.websearch.question
    const links = extractResults.websearch.links

    const span = webSearchProvider.topicId
      ? await addSpan({
          topicId: webSearchProvider.topicId,
          name: 'WebSearch',
          inputs: { question: questions, provider: webSearchProvider.id },
          tag: 'Web',
          parentSpanId: webSearchProvider.parentSpanId,
          modelName: webSearchProvider.modelName
        })
      : undefined

    if (questions[0] === 'summarize' && links && links.length > 0) {
      const contents = await fetchWebContents(links, undefined, undefined, { signal })
      if (webSearchProvider.topicId) {
        endSpan({ topicId: webSearchProvider.topicId, outputs: contents, modelName: webSearchProvider.modelName, span })
      }
      return { query: 'summaries', results: contents }
    }

    const searchWithTime = await preferenceService.get('chat.websearch.search_with_time')
    const webSearchEngine = new WebSearchEngineProvider(webSearchProvider, span?.spanContext().spanId)

    const searchPromises = questions.map(async (q) => {
      const formattedQuery = searchWithTime ? `today is ${dayjs().format('YYYY-MM-DD')} \r\n ${q}` : q
      return await webSearchEngine.search(formattedQuery, { signal })
    })

    const searchResults = await Promise.allSettled(searchPromises)

    const successfulSearchCount = searchResults.filter((result) => result.status === 'fulfilled').length
    logger.verbose(`Successful search count: ${successfulSearchCount}`)

    if (successfulSearchCount > 1) {
      await this.statusTracker.setStatus(
        requestId,
        { phase: 'fetch_complete', countAfter: successfulSearchCount },
        1000
      )
    }

    let finalResults: WebSearchProviderResult[] = []
    searchResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value.results) {
        finalResults.push(...result.value.results)
      }
      if (result.status === 'rejected') {
        throw result.reason
      }
    })

    logger.verbose(`FulFilled search result count: ${finalResults.length}`)

    if (finalResults.length === 0) {
      await this.statusTracker.setStatus(requestId, { phase: 'default' })
      if (webSearchProvider.topicId) {
        endSpan({
          topicId: webSearchProvider.topicId,
          outputs: finalResults,
          modelName: webSearchProvider.modelName,
          span
        })
      }
      return { query: questions.join(' | '), results: [] }
    }

    const compressionMethod = await preferenceService.get('chat.websearch.compression.method')

    if (compressionMethod && compressionMethod !== 'none') {
      const strategy = await this.compressionFactory.getStrategy()
      const originalCount = finalResults.length

      if (strategy.name === 'rag') {
        await this.statusTracker.setStatus(requestId, { phase: 'rag' }, 500)
        try {
          finalResults = await strategy.compress(finalResults, { questions, requestId })
          await this.statusTracker.setStatus(
            requestId,
            { phase: 'rag_complete', countBefore: originalCount, countAfter: finalResults.length },
            1000
          )
        } catch (error) {
          logger.warn('RAG compression failed:', error as Error)
          window.toast.error({
            timeout: 10000,
            title: `${i18n.t('settings.tool.websearch.compression.error.rag_failed')}: ${formatErrorMessage(error)}`
          })
          finalResults = []
          await this.statusTracker.setStatus(requestId, { phase: 'rag_failed' }, 1000)
        }
      } else if (strategy.name === 'cutoff') {
        await this.statusTracker.setStatus(requestId, { phase: 'cutoff' }, 500)
        finalResults = await strategy.compress(finalResults, { questions, requestId })
      }
    }

    await this.statusTracker.setStatus(requestId, { phase: 'default' })

    if (webSearchProvider.topicId) {
      endSpan({
        topicId: webSearchProvider.topicId,
        outputs: finalResults,
        modelName: webSearchProvider.modelName,
        span
      })
    }

    return { query: questions.join(' | '), results: finalResults }
  }
}
