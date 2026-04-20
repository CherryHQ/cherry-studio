import { cacheService } from '@data/CacheService'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT } from '@renderer/config/constant'
import { filterSupportedWebSearchProviders, webSearchProviderRequiresApiKey } from '@renderer/config/webSearchProviders'
import { getStoreProviders } from '@renderer/hooks/useStore'
import i18n from '@renderer/i18n'
import WebSearchEngineProvider from '@renderer/providers/WebSearchProvider'
import { addSpan, endSpan } from '@renderer/services/SpanManagerService'
import type {
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeReference,
  Model,
  RendererCompressionConfig,
  WebSearchProvider,
  WebSearchProviderResponse,
  WebSearchProviderResult,
  WebSearchState,
  WebSearchStatus
} from '@renderer/types'
import { removeSpecialCharactersForFileName, uuid } from '@renderer/utils'
import { addAbortController } from '@renderer/utils/abortController'
import { formatErrorMessage } from '@renderer/utils/error'
import type { ExtractResults } from '@renderer/utils/extract'
import { fetchWebContents } from '@renderer/utils/fetch'
import { consolidateReferencesByUrl, selectReferences } from '@renderer/utils/websearch'
import type {
  PreferenceDefaultScopeType,
  PreferenceKeyType,
  WebSearchProviderId,
  WebSearchProviderOverride,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import { getDefaultValue } from '@shared/data/preference/preferenceUtils'
import { PRESETS_WEB_SEARCH_PROVIDERS } from '@shared/data/presets/web-search-providers'
import { sliceByTokens } from 'tokenx'

import { getKnowledgeBaseParams } from './KnowledgeService'
import { getKnowledgeSourceUrl, searchKnowledgeBase } from './KnowledgeService'
import { getModelUniqId } from './ModelService'

const logger = loggerService.withContext('WebSearchService')

type WebSearchPreferenceSnapshot = Pick<
  PreferenceDefaultScopeType,
  | 'chat.web_search.default_provider'
  | 'chat.web_search.exclude_domains'
  | 'chat.web_search.max_results'
  | 'chat.web_search.provider_overrides'
  | 'chat.web_search.subscribe_sources'
  | 'chat.web_search.compression.method'
  | 'chat.web_search.compression.cutoff_limit'
  | 'chat.web_search.compression.cutoff_unit'
  | 'chat.web_search.compression.rag_document_count'
  | 'chat.web_search.compression.rag_embedding_model_id'
  | 'chat.web_search.compression.rag_embedding_dimensions'
  | 'chat.web_search.compression.rag_rerank_model_id'
>

type ModelResolver = (uniqId: string | null) => Model | undefined

interface RequestState {
  signal: AbortSignal | null
  isPaused: boolean
  createdAt: number
}

/**
 * 提供网络搜索相关功能的服务类
 */
export class WebSearchService {
  /**
   * 是否暂停
   */
  private signal: AbortSignal | null = null

  isPaused = false

  // 管理不同请求的状态
  private requestStates = new Map<string, RequestState>()

  /**
   * 获取或创建单个请求的状态
   * @param requestId 请求 ID（通常是消息 ID）
   */
  private getRequestState(requestId: string): RequestState {
    let state = this.requestStates.get(requestId)
    if (!state) {
      state = {
        signal: null,
        isPaused: false,
        createdAt: Date.now()
      }
      this.requestStates.set(requestId, state)
    }
    return state
  }

  createAbortSignal(requestId: string) {
    const controller = new AbortController()
    this.signal = controller.signal // 保持向后兼容

    const state = this.getRequestState(requestId)
    state.signal = controller.signal

    addAbortController(requestId, () => {
      this.isPaused = true // 保持向后兼容
      state.isPaused = true
      this.signal = null
      this.requestStates.delete(requestId)
      controller.abort()
    })
    return controller
  }

  /**
   * 获取当前存储的网络搜索状态
   * @private
   * @returns 网络搜索状态
   */
  private getWebSearchState(): WebSearchState {
    return getCachedRendererWebSearchState((uniqId) => {
      if (!uniqId) {
        return undefined
      }

      return getStoreProviders()
        .filter((provider) => provider.enabled)
        .flatMap((provider) => provider.models)
        .find((model) => getModelUniqId(model) === uniqId)
    })
  }

  /**
   * 检查网络搜索功能是否启用
   * @public
   * @returns 如果默认搜索提供商已启用则返回true，否则返回false
   */
  public isWebSearchEnabled(providerId?: WebSearchProvider['id']): boolean {
    const providers = filterSupportedWebSearchProviders(this.getWebSearchState().providers)
    const provider = providers.find((provider) => provider.id === providerId)

    if (!provider) {
      return false
    }

    if (webSearchProviderRequiresApiKey(provider.id)) {
      return provider.apiKey?.trim() !== ''
    }

    return provider.apiHost?.trim() !== ''
  }

  /**
   * @deprecated 支持在快捷菜单中自选搜索供应商，所以这个不再适用
   *
   * 检查是否启用覆盖搜索
   * @public
   * @returns 如果启用覆盖搜索则返回true，否则返回false
   */
  public isOverwriteEnabled(): boolean {
    const { overwrite } = this.getWebSearchState()
    return overwrite
  }

  /**
   * 获取当前默认的网络搜索提供商
   * @public
   * @returns 网络搜索提供商
   */
  public getWebSearchProvider(providerId?: string): WebSearchProvider | undefined {
    const providers = filterSupportedWebSearchProviders(this.getWebSearchState().providers)
    logger.debug('providers', providers)
    const provider = providers.find((provider) => provider.id === providerId)

    return provider
  }

  /**
   * 使用指定的提供商执行网络搜索
   * @public
   * @param provider 搜索提供商
   * @param query 搜索查询
   * @returns 搜索响应
   */
  public async search(
    provider: WebSearchProvider,
    query: string,
    httpOptions?: RequestInit,
    spanId?: string
  ): Promise<WebSearchProviderResponse> {
    const websearch = this.getWebSearchState()
    const webSearchEngine = new WebSearchEngineProvider(provider, spanId)

    return await webSearchEngine.search(query, websearch, httpOptions)
  }

  /**
   * 检查搜索提供商是否正常工作
   * @public
   * @param provider 要检查的搜索提供商
   * @returns 如果提供商可用返回true，否则返回false
   */
  public async checkSearch(provider: WebSearchProvider): Promise<{ valid: boolean; error?: any }> {
    try {
      const response = await this.search(provider, 'test query')
      logger.debug('Search response:', response)
      // 优化的判断条件：检查结果是否有效且没有错误
      return { valid: response.results !== undefined, error: undefined }
    } catch (error) {
      return { valid: false, error }
    }
  }

  /**
   * 设置网络搜索状态
   */
  private async setWebSearchStatus(requestId: string, status: WebSearchStatus, delayMs?: number) {
    const activeSearches = cacheService.getShared('chat.web_search.active_searches') ?? {}
    cacheService.setShared('chat.web_search.active_searches', {
      ...activeSearches,
      [requestId]: status
    })

    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  /**
   * 创建临时搜索知识库
   */
  private async ensureSearchBase(
    config: RendererCompressionConfig,
    documentCount: number,
    requestId: string
  ): Promise<KnowledgeBase> {
    // requestId: eg: openai-responses-openai/gpt-5-timestamp-uuid
    const baseId = `websearch-compression-${requestId}`

    if (!config.embeddingModel) {
      throw new Error('Embedding model is required for RAG compression')
    }

    // 创建新的知识库
    const searchBase: KnowledgeBase = {
      id: baseId,
      name: `WebSearch-RAG-${requestId}`,
      model: config.embeddingModel,
      rerankModel: config.rerankModel,
      dimensions: config.embeddingDimensions,
      documentCount,
      items: [],
      created_at: Date.now(),
      updated_at: Date.now(),
      version: 1
    }

    // 创建知识库
    const baseParams = getKnowledgeBaseParams(searchBase)
    await window.api.knowledgeBase.create(baseParams)

    return searchBase
  }

  /**
   * 清理临时搜索知识库
   */
  private async cleanupSearchBase(searchBase: KnowledgeBase): Promise<void> {
    try {
      await window.api.knowledgeBase.delete(removeSpecialCharactersForFileName(searchBase.id))
      logger.debug(`Cleaned up search base: ${searchBase.id}`)
    } catch (error) {
      logger.warn(`Failed to cleanup search base ${searchBase.id}:`, error as Error)
    }
  }

  /**
   * 对搜索知识库执行多问题查询并按分数排序
   * @param questions 问题列表
   * @param searchBase 搜索知识库
   * @returns 排序后的知识引用列表
   */
  private async querySearchBase(questions: string[], searchBase: KnowledgeBase): Promise<KnowledgeReference[]> {
    // 1. 单独搜索每个问题
    const searchPromises = questions.map((question) => searchKnowledgeBase(question, searchBase))
    const allResults = await Promise.all(searchPromises)

    // 2. 合并所有结果并按分数排序
    const flatResults = allResults.flat().sort((a, b) => b.score - a.score)

    logger.debug(`Found ${flatResults.length} result(s) in search base related to question(s): `, questions)

    // 3. 去重，保留最高分的重复内容
    const seen = new Set<string>()
    const uniqueResults = flatResults.filter((item) => {
      if (seen.has(item.pageContent)) {
        return false
      }
      seen.add(item.pageContent)
      return true
    })

    logger.debug(`Found ${uniqueResults.length} unique result(s) from search base after sorting and deduplication`)

    // 4. 转换为引用格式
    return await Promise.all(
      uniqueResults.map(async (result, index) => ({
        id: index + 1,
        content: result.pageContent,
        sourceUrl: await getKnowledgeSourceUrl(result),
        type: 'url' as const
      }))
    )
  }

  /**
   * 使用RAG压缩搜索结果。
   * - 一次性将所有搜索结果添加到知识库
   * - 从知识库中 retrieve 相关结果
   * - 根据 sourceUrl 映射回原始搜索结果
   *
   * @param questions 问题列表
   * @param rawResults 原始搜索结果
   * @param config 压缩配置
   * @param requestId 请求ID
   * @returns 压缩后的搜索结果
   */
  private async compressWithSearchBase(
    questions: string[],
    rawResults: WebSearchProviderResult[],
    config: RendererCompressionConfig,
    requestId: string
  ): Promise<WebSearchProviderResult[]> {
    // 根据搜索次数计算所需的文档数量
    const totalDocumentCount =
      Math.max(0, rawResults.length) * (config.documentCount ?? DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT)

    const searchBase = await this.ensureSearchBase(config, totalDocumentCount, requestId)
    logger.debug('Search base for RAG compression: ', searchBase)

    try {
      // 1. 清空知识库
      const baseParams = getKnowledgeBaseParams(searchBase)
      await window.api.knowledgeBase.reset(baseParams)

      logger.debug('Search base parameters for RAG compression: ', baseParams)

      // 2. 顺序添加所有搜索结果到知识库
      // FIXME: 目前的知识库 add 不支持并发
      for (const result of rawResults) {
        const item: KnowledgeItem & { sourceUrl?: string } = {
          id: uuid(),
          type: 'note',
          content: result.content,
          sourceUrl: result.url, // 设置 sourceUrl 用于映射
          created_at: Date.now(),
          updated_at: Date.now(),
          processingStatus: 'pending'
        }

        await window.api.knowledgeBase.add({
          base: getKnowledgeBaseParams(searchBase),
          item
        })
      }

      // 3. 对知识库执行多问题搜索获取压缩结果
      const references = await this.querySearchBase(questions, searchBase)

      // 4. 使用 Round Robin 策略选择引用
      const selectedReferences = selectReferences(rawResults, references, totalDocumentCount)

      logger.verbose('With RAG, the number of search results:', {
        raw: rawResults.length,
        retrieved: references.length,
        selected: selectedReferences.length
      })

      // 5. 按 sourceUrl 分组并合并同源片段
      return consolidateReferencesByUrl(rawResults, selectedReferences)
    } finally {
      // 无论成功或失败都立即清理知识库
      await this.cleanupSearchBase(searchBase)
    }
  }

  /**
   * 使用截断方式压缩搜索结果，可以选择单位 char 或 token。
   *
   * @param rawResults 原始搜索结果
   * @param config 压缩配置
   * @returns 截断后的搜索结果
   */
  private async compressWithCutoff(
    rawResults: WebSearchProviderResult[],
    config: RendererCompressionConfig
  ): Promise<WebSearchProviderResult[]> {
    if (!config.cutoffLimit) {
      logger.warn('Cutoff limit is not set, skipping compression')
      return rawResults
    }

    const perResultLimit = Math.max(1, Math.floor(config.cutoffLimit / rawResults.length))

    return rawResults.map((result) => {
      if (config.cutoffUnit === 'token') {
        // 使用 token 截断
        const slicedContent = sliceByTokens(result.content, 0, perResultLimit)
        return {
          ...result,
          content: slicedContent.length < result.content.length ? slicedContent + '...' : slicedContent
        }
      } else {
        // 使用字符截断（默认行为）
        return {
          ...result,
          content:
            result.content.length > perResultLimit ? result.content.slice(0, perResultLimit) + '...' : result.content
        }
      }
    })
  }

  /**
   * 处理网络搜索请求的核心方法，处理过程中会设置运行时状态供 UI 使用。
   *
   * 该方法执行以下步骤：
   * - 验证输入参数并处理边界情况
   * - 处理特殊的summarize请求
   * - 并行执行多个搜索查询
   * - 聚合搜索结果并处理失败情况
   * - 根据配置应用结果压缩（RAG或截断）
   * - 返回最终的搜索响应
   *
   * @param webSearchProvider - 要使用的网络搜索提供商
   * @param extractResults - 包含搜索问题和链接的提取结果对象
   * @param requestId - 唯一的请求标识符，用于状态跟踪和资源管理
   *
   * @returns 包含搜索结果的响应对象
   */
  public async processWebsearch(
    webSearchProvider: WebSearchProvider,
    extractResults: ExtractResults,
    requestId: string
  ): Promise<WebSearchProviderResponse> {
    // 重置状态
    await this.setWebSearchStatus(requestId, { phase: 'default' })

    // 检查 websearch 和 question 是否有效
    if (!extractResults.websearch?.question || extractResults.websearch.question.length === 0) {
      logger.info('No valid question found in extractResults.websearch')
      return { results: [] }
    }

    // 使用请求特定的signal，如果没有则回退到全局signal
    const signal = this.getRequestState(requestId).signal || this.signal

    const span = webSearchProvider.topicId
      ? await addSpan({
          topicId: webSearchProvider.topicId,
          name: `WebSearch`,
          inputs: {
            question: extractResults.websearch.question,
            provider: webSearchProvider.id
          },
          tag: `Web`,
          parentSpanId: webSearchProvider.parentSpanId,
          modelName: webSearchProvider.modelName
        })
      : undefined
    const questions = extractResults.websearch.question
    const links = extractResults.websearch.links

    // 处理 summarize
    if (questions[0] === 'summarize' && links && links.length > 0) {
      const contents = await fetchWebContents(links, undefined, undefined, {
        signal
      })
      webSearchProvider.topicId &&
        endSpan({
          topicId: webSearchProvider.topicId,
          outputs: contents,
          modelName: webSearchProvider.modelName,
          span
        })
      return { query: 'summaries', results: contents }
    }

    const searchPromises = questions.map((q) =>
      this.search(webSearchProvider, q, { signal }, span?.spanContext().spanId)
    )
    const searchResults = await Promise.allSettled(searchPromises)

    // 统计成功完成的搜索数量
    const successfulSearchCount = searchResults.filter((result) => result.status === 'fulfilled').length
    logger.verbose(`Successful search count: ${successfulSearchCount}`)
    if (successfulSearchCount > 1) {
      await this.setWebSearchStatus(
        requestId,
        {
          phase: 'fetch_complete',
          countAfter: successfulSearchCount
        },
        1000
      )
    }

    let finalResults: WebSearchProviderResult[] = []
    searchResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        if (result.value.results) {
          finalResults.push(...result.value.results)
        }
      }
      if (result.status === 'rejected') {
        throw result.reason
      }
    })

    logger.verbose(`FulFilled search result count: ${finalResults.length}`)
    logger.verbose(
      'FulFilled search result: ',
      finalResults.map(({ title, url }) => ({ title, url }))
    )

    // 如果没有搜索结果，直接返回空结果
    if (finalResults.length === 0) {
      await this.setWebSearchStatus(requestId, { phase: 'default' })
      if (webSearchProvider.topicId) {
        endSpan({
          topicId: webSearchProvider.topicId,
          outputs: finalResults,
          modelName: webSearchProvider.modelName,
          span
        })
      }
      return {
        query: questions.join(' | '),
        results: []
      }
    }

    const { compressionConfig } = this.getWebSearchState()

    // RAG压缩处理
    if (compressionConfig?.method === 'rag' && requestId) {
      await this.setWebSearchStatus(requestId, { phase: 'rag' }, 500)

      const originalCount = finalResults.length

      try {
        finalResults = await this.compressWithSearchBase(questions, finalResults, compressionConfig, requestId)
        await this.setWebSearchStatus(
          requestId,
          {
            phase: 'rag_complete',
            countBefore: originalCount,
            countAfter: finalResults.length
          },
          1000
        )
      } catch (error) {
        logger.warn('RAG compression failed, will return empty results:', error as Error)
        window.toast.error({
          timeout: 10000,
          title: `${i18n.t('settings.tool.websearch.compression.error.rag_failed')}: ${formatErrorMessage(error)}`
        })

        finalResults = []
        await this.setWebSearchStatus(requestId, { phase: 'rag_failed' }, 1000)
      }
    }
    // 截断压缩处理
    else if (compressionConfig?.method === 'cutoff' && compressionConfig.cutoffLimit) {
      await this.setWebSearchStatus(requestId, { phase: 'cutoff' }, 500)
      finalResults = await this.compressWithCutoff(finalResults, compressionConfig)
    }

    // 重置状态
    await this.setWebSearchStatus(requestId, { phase: 'default' })

    if (webSearchProvider.topicId) {
      endSpan({
        topicId: webSearchProvider.topicId,
        outputs: finalResults,
        modelName: webSearchProvider.modelName,
        span
      })
    }
    return {
      query: questions.join(' | '),
      results: finalResults
    }
  }
}

export const webSearchService = new WebSearchService()

export function parseApiKeys(apiKey?: string): string[] | undefined {
  if (!apiKey) {
    return undefined
  }

  const apiKeys = apiKey
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)

  return apiKeys.length > 0 ? apiKeys : undefined
}

export function stringifyApiKeys(apiKeys?: string[]): string {
  return (
    apiKeys
      ?.map((key) => key.trim())
      .filter(Boolean)
      .join(',') ?? ''
  )
}

export function resolveWebSearchProviders(overrides: WebSearchProviderOverrides): WebSearchProvider[] {
  return PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => {
    const override = overrides[preset.id]

    return {
      id: preset.id,
      name: preset.name,
      apiKey: stringifyApiKeys(override?.apiKeys),
      apiHost: override?.apiHost?.trim() || preset.defaultApiHost,
      engines: override?.engines || [],
      basicAuthUsername: override?.basicAuthUsername?.trim() || '',
      basicAuthPassword: override?.basicAuthPassword?.trim() || ''
    }
  })
}

export function buildWebSearchProviderOverrides(providers: WebSearchProvider[]): WebSearchProviderOverrides {
  return providers.reduce<WebSearchProviderOverrides>((acc, provider) => {
    const normalizedOverride = normalizeWebSearchProviderOverride({
      apiKeys: parseApiKeys(provider.apiKey),
      apiHost: provider.apiHost,
      engines: provider.engines,
      basicAuthUsername: provider.basicAuthUsername,
      basicAuthPassword: provider.basicAuthPassword
    })

    if (Object.keys(normalizedOverride).length > 0) {
      acc[provider.id] = normalizedOverride
    }

    return acc
  }, {})
}

export function updateWebSearchProviderOverride(
  overrides: WebSearchProviderOverrides,
  providerId: WebSearchProviderId,
  updates: Partial<WebSearchProvider>
): WebSearchProviderOverrides {
  const currentOverride = overrides[providerId] ?? {}
  const nextOverride: WebSearchProviderOverride = {
    ...currentOverride,
    apiKeys: updates.apiKey !== undefined ? parseApiKeys(updates.apiKey) : currentOverride.apiKeys,
    apiHost: updates.apiHost !== undefined ? updates.apiHost : currentOverride.apiHost,
    engines: updates.engines !== undefined ? updates.engines : currentOverride.engines,
    basicAuthUsername:
      updates.basicAuthUsername !== undefined ? updates.basicAuthUsername : currentOverride.basicAuthUsername,
    basicAuthPassword:
      updates.basicAuthPassword !== undefined ? updates.basicAuthPassword : currentOverride.basicAuthPassword
  }

  const normalizedOverride = normalizeWebSearchProviderOverride(nextOverride)

  if (Object.keys(normalizedOverride).length === 0) {
    const restOverrides = { ...overrides }
    delete restOverrides[providerId]
    return restOverrides
  }

  return {
    ...overrides,
    [providerId]: normalizedOverride
  }
}

export function buildRendererWebSearchState(
  preferences: WebSearchPreferenceSnapshot,
  resolveModel?: ModelResolver
): WebSearchState {
  const compressionMethod = preferences['chat.web_search.compression.method']
  const embeddingModelId = preferences['chat.web_search.compression.rag_embedding_model_id']
  const rerankModelId = preferences['chat.web_search.compression.rag_rerank_model_id']

  return {
    defaultProvider: preferences['chat.web_search.default_provider'],
    providers: resolveWebSearchProviders(preferences['chat.web_search.provider_overrides']),
    searchWithTime: false,
    maxResults: Math.max(1, preferences['chat.web_search.max_results']),
    excludeDomains: preferences['chat.web_search.exclude_domains'],
    subscribeSources: preferences['chat.web_search.subscribe_sources'],
    overwrite: false,
    compressionConfig: {
      method: compressionMethod,
      cutoffLimit: preferences['chat.web_search.compression.cutoff_limit'] ?? undefined,
      cutoffUnit: preferences['chat.web_search.compression.cutoff_unit'],
      documentCount:
        preferences['chat.web_search.compression.rag_document_count'] || DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT,
      embeddingModel: resolveModel?.(embeddingModelId) ?? undefined,
      embeddingDimensions: preferences['chat.web_search.compression.rag_embedding_dimensions'] ?? undefined,
      rerankModel: resolveModel?.(rerankModelId) ?? undefined
    }
  }
}

export async function getRendererWebSearchState(resolveModel?: ModelResolver): Promise<WebSearchState> {
  const preferences = await preferenceService.getMultiple({
    defaultProvider: 'chat.web_search.default_provider',
    excludeDomains: 'chat.web_search.exclude_domains',
    maxResults: 'chat.web_search.max_results',
    providerOverrides: 'chat.web_search.provider_overrides',
    subscribeSources: 'chat.web_search.subscribe_sources',
    compressionMethod: 'chat.web_search.compression.method',
    cutoffLimit: 'chat.web_search.compression.cutoff_limit',
    cutoffUnit: 'chat.web_search.compression.cutoff_unit',
    ragDocumentCount: 'chat.web_search.compression.rag_document_count',
    ragEmbeddingModelId: 'chat.web_search.compression.rag_embedding_model_id',
    ragEmbeddingDimensions: 'chat.web_search.compression.rag_embedding_dimensions',
    ragRerankModelId: 'chat.web_search.compression.rag_rerank_model_id'
  })

  return buildRendererWebSearchState(
    {
      'chat.web_search.default_provider': preferences.defaultProvider,
      'chat.web_search.exclude_domains': preferences.excludeDomains,
      'chat.web_search.max_results': preferences.maxResults,
      'chat.web_search.provider_overrides': preferences.providerOverrides,
      'chat.web_search.subscribe_sources': preferences.subscribeSources,
      'chat.web_search.compression.method': preferences.compressionMethod,
      'chat.web_search.compression.cutoff_limit': preferences.cutoffLimit,
      'chat.web_search.compression.cutoff_unit': preferences.cutoffUnit,
      'chat.web_search.compression.rag_document_count': preferences.ragDocumentCount,
      'chat.web_search.compression.rag_embedding_model_id': preferences.ragEmbeddingModelId,
      'chat.web_search.compression.rag_embedding_dimensions': preferences.ragEmbeddingDimensions,
      'chat.web_search.compression.rag_rerank_model_id': preferences.ragRerankModelId
    },
    resolveModel
  )
}

export function getCachedRendererWebSearchState(resolveModel?: ModelResolver): WebSearchState {
  const getCachedPreference = <K extends PreferenceKeyType>(key: K): PreferenceDefaultScopeType[K] => {
    const cachedValue = preferenceService.getCachedValue(key)
    return (cachedValue !== undefined ? cachedValue : getDefaultValue(key)) as PreferenceDefaultScopeType[K]
  }

  return buildRendererWebSearchState(
    {
      'chat.web_search.default_provider': getCachedPreference('chat.web_search.default_provider'),
      'chat.web_search.exclude_domains': getCachedPreference('chat.web_search.exclude_domains'),
      'chat.web_search.max_results': getCachedPreference('chat.web_search.max_results'),
      'chat.web_search.provider_overrides': getCachedPreference('chat.web_search.provider_overrides'),
      'chat.web_search.subscribe_sources': getCachedPreference('chat.web_search.subscribe_sources'),
      'chat.web_search.compression.method': getCachedPreference('chat.web_search.compression.method'),
      'chat.web_search.compression.cutoff_limit': getCachedPreference('chat.web_search.compression.cutoff_limit'),
      'chat.web_search.compression.cutoff_unit': getCachedPreference('chat.web_search.compression.cutoff_unit'),
      'chat.web_search.compression.rag_document_count': getCachedPreference(
        'chat.web_search.compression.rag_document_count'
      ),
      'chat.web_search.compression.rag_embedding_model_id': getCachedPreference(
        'chat.web_search.compression.rag_embedding_model_id'
      ),
      'chat.web_search.compression.rag_embedding_dimensions': getCachedPreference(
        'chat.web_search.compression.rag_embedding_dimensions'
      ),
      'chat.web_search.compression.rag_rerank_model_id': getCachedPreference(
        'chat.web_search.compression.rag_rerank_model_id'
      )
    },
    resolveModel
  )
}

function normalizeWebSearchProviderOverride(override: WebSearchProviderOverride): WebSearchProviderOverride {
  const normalizedOverride: WebSearchProviderOverride = {}

  if (override.apiKeys !== undefined) {
    normalizedOverride.apiKeys = override.apiKeys.map((key) => key.trim()).filter(Boolean)
  }

  if (override.apiHost !== undefined) {
    normalizedOverride.apiHost = override.apiHost.trim()
  }

  if (override.engines !== undefined) {
    normalizedOverride.engines = override.engines
  }

  if (override.basicAuthUsername !== undefined) {
    normalizedOverride.basicAuthUsername = override.basicAuthUsername.trim()
  }

  if (override.basicAuthPassword !== undefined) {
    normalizedOverride.basicAuthPassword = override.basicAuthPassword
  }

  return normalizedOverride
}
