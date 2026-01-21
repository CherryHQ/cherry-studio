import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { getProviderTemplate, mergeProviderConfig } from '@renderer/config/webSearch'
import type { WebSearchProviderResponse } from '@renderer/types'
import type { ExtractResults } from '@renderer/utils/extract'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'

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
    if (!providerId) {
      logger.debug('No provider ID provided')
      return undefined
    }

    // Get template first
    const template = getProviderTemplate(providerId)
    if (!template) {
      const errorMsg = `Web search provider "${providerId}" not found. Please check your configuration.`
      logger.error(errorMsg)
      throw new Error(errorMsg)
    }

    // Get user configs from preference
    const userConfigs = await preferenceService.get('chat.websearch.providers')
    const userConfig = userConfigs.find((c) => c.id === providerId)

    // Merge template with user config
    const provider = mergeProviderConfig(template, userConfig)
    logger.debug('provider', provider)
    return provider
  }

  public async search(
    provider: WebSearchProvider,
    query: string,
    httpOptions?: RequestInit
  ): Promise<WebSearchProviderResponse> {
    const webSearchEngine = new WebSearchEngineProvider(provider)
    return await webSearchEngine.search(query, httpOptions)
  }

  public async checkSearch(provider: WebSearchProvider): Promise<{ valid: boolean; error?: any }> {
    try {
      const response = await this.search(provider, 'test query')
      logger.debug('Search response:', response)
      return { valid: response.results !== undefined, error: undefined }
    } catch (error) {
      logger.warn('Search check failed for provider:', {
        providerId: provider.id,
        error: error instanceof Error ? error.message : error
      })
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
