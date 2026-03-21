import { loggerService } from '@logger'
import type { WebSearchRequest, WebSearchResponse } from '@shared/data/types/webSearch'
import dayjs from 'dayjs'

import type { WebSearchConfigResolver } from './config/WebSearchConfigResolver'
import { webSearchConfigResolver } from './config/WebSearchConfigResolver'
import { applyWebSearchPostProcessing } from './processing/postProcessor'
import { createWebSearchProvider } from './providers/factory'
import { clearWebSearchStatus, setWebSearchStatus } from './runtime/status'
import { filterWebSearchResponseWithBlacklist } from './utils/blacklist'

const logger = loggerService.withContext('MainWebSearchService')

export class WebSearchService {
  constructor(private readonly configResolver: WebSearchConfigResolver = webSearchConfigResolver) {}

  async search(request: WebSearchRequest, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    try {
      const provider = await this.configResolver.getProviderById(request.providerId)
      if (!provider) {
        throw new Error(`Unsupported or unavailable provider: ${request.providerId}`)
      }

      const runtimeConfig = await this.configResolver.getRuntimeConfig()
      const questions = request.input.question

      if (questions.length === 0) {
        return {
          query: '',
          results: []
        }
      }

      const providerDriver = createWebSearchProvider(provider)
      const searchPromises = questions.map((query) => {
        const formattedQuery = runtimeConfig.searchWithTime
          ? `today is ${dayjs().format('YYYY-MM-DD')}\r\n ${query}`
          : query

        return providerDriver.search(formattedQuery, runtimeConfig, httpOptions)
      })

      const searchResults = await Promise.allSettled(searchPromises)
      const successfulSearchCount = searchResults.filter((item) => item.status === 'fulfilled').length

      if (successfulSearchCount > 1) {
        await setWebSearchStatus(
          request.requestId,
          {
            phase: 'fetch_complete',
            countAfter: successfulSearchCount
          },
          1000
        )
      }

      const allResults = searchResults.flatMap((item) => {
        if (item.status === 'rejected') {
          throw item.reason
        }
        return item.value.results
      })

      const mergedResponse: WebSearchResponse = {
        query: questions.join(' | '),
        results: allResults
      }

      const filteredResponse = filterWebSearchResponseWithBlacklist(mergedResponse, runtimeConfig.excludeDomains)

      if (
        filteredResponse.results.length > 0 &&
        runtimeConfig.compression.method === 'cutoff' &&
        runtimeConfig.compression.cutoffLimit
      ) {
        await setWebSearchStatus(request.requestId, { phase: 'cutoff' }, 500)
      }
      // TODO RAG

      const processedResponse = applyWebSearchPostProcessing(filteredResponse, runtimeConfig)
      return processedResponse
    } catch (error) {
      logger.error('Web search failed', error as Error)
      throw error
    } finally {
      await clearWebSearchStatus(request.requestId)
    }
  }

  async checkProvider(providerId: WebSearchRequest['providerId']) {
    try {
      const provider = await this.configResolver.getProviderById(providerId)
      if (!provider) {
        throw new Error(`Unsupported or unavailable provider: ${providerId}`)
      }

      const providerDriver = createWebSearchProvider(provider)
      await providerDriver.check()

      return { valid: true, error: undefined }
    } catch (error) {
      return { valid: false, error }
    }
  }
}

export const webSearchService = new WebSearchService()
