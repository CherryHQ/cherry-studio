import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import type { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'
import type { ExtractResults } from '@renderer/utils/extract'

import { CompressionStrategyFactory } from './compression'
import WebSearchEngineProvider from './providers/WebSearchEngineProvider'
import { RequestStateManager } from './RequestStateManager'
import { SearchStatusTracker } from './SearchStatusTracker'
import { WebSearchOrchestrator } from './WebSearchOrchestrator'

const logger = loggerService.withContext('WebSearchService')

class WebSearchService {
  private orchestrator: WebSearchOrchestrator
  private requestStateManager: RequestStateManager
  private statusTracker: SearchStatusTracker

  constructor() {
    this.statusTracker = new SearchStatusTracker()
    this.requestStateManager = new RequestStateManager((requestId) => this.statusTracker.clearStatus(requestId))
    const compressionFactory = new CompressionStrategyFactory()

    this.orchestrator = new WebSearchOrchestrator(this.requestStateManager, this.statusTracker, compressionFactory)
  }

  get isPaused() {
    return this.requestStateManager.isPaused
  }

  createAbortSignal(requestId: string) {
    return this.requestStateManager.createAbortSignal(requestId)
  }

  public async getWebSearchProvider(providerId?: string): Promise<WebSearchProvider | undefined> {
    const providers = await preferenceService.get('chat.websearch.providers')
    logger.debug('providers', providers)
    return providers.find((provider) => provider.id === providerId)
  }

  public async search(
    provider: WebSearchProvider,
    query: string,
    httpOptions?: RequestInit,
    spanId?: string
  ): Promise<WebSearchProviderResponse> {
    const webSearchEngine = new WebSearchEngineProvider(provider, spanId)
    return await webSearchEngine.search(query, httpOptions)
  }

  public async checkSearch(provider: WebSearchProvider): Promise<{ valid: boolean; error?: any }> {
    try {
      const response = await this.search(provider, 'test query')
      logger.debug('Search response:', response)
      return { valid: response.results !== undefined, error: undefined }
    } catch (error) {
      return { valid: false, error }
    }
  }

  public async processWebsearch(
    webSearchProvider: WebSearchProvider,
    extractResults: ExtractResults,
    requestId: string
  ): Promise<WebSearchProviderResponse> {
    return this.orchestrator.processWebsearch(webSearchProvider, extractResults, requestId)
  }
}

export default new WebSearchService()
