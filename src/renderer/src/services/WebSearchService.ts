import { cacheService } from '@data/CacheService'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { filterSupportedWebSearchProviders, webSearchProviderRequiresApiKey } from '@renderer/config/webSearchProviders'
import WebSearchEngineProvider from '@renderer/providers/WebSearchProvider'
import { addSpan, endSpan } from '@renderer/services/SpanManagerService'
import type {
  RendererCompressionConfig,
  WebSearchProvider,
  WebSearchProviderResponse,
  WebSearchProviderResult,
  WebSearchState,
  WebSearchStatus
} from '@renderer/types'
import { addAbortController } from '@renderer/utils/abortController'
import type { ExtractResults } from '@renderer/utils/extract'
import { fetchWebContents } from '@renderer/utils/fetch'
import type {
  PreferenceDefaultScopeType,
  PreferenceKeyType,
  WebSearchProviderId,
  WebSearchProviderOverride,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import { getDefaultValue } from '@shared/data/preference/preferenceUtils'
import { PRESETS_WEB_SEARCH_PROVIDERS } from '@shared/data/presets/web-search-providers'
import { normalizeWebSearchCutoffLimit } from '@shared/data/types/webSearch'
import { sliceByTokens } from 'tokenx'

const logger = loggerService.withContext('WebSearchService')

type WebSearchPreferenceSnapshot = Pick<
  PreferenceDefaultScopeType,
  | 'chat.web_search.default_provider'
  | 'chat.web_search.exclude_domains'
  | 'chat.web_search.max_results'
  | 'chat.web_search.provider_overrides'
  | 'chat.web_search.search_with_time'
  | 'chat.web_search.subscribe_sources'
  | 'chat.web_search.compression.method'
  | 'chat.web_search.compression.cutoff_limit'
  | 'chat.web_search.compression.cutoff_unit'
>

export const WEB_SEARCH_PREFERENCE_KEYS = {
  defaultProvider: 'chat.web_search.default_provider',
  excludeDomains: 'chat.web_search.exclude_domains',
  maxResults: 'chat.web_search.max_results',
  providerOverrides: 'chat.web_search.provider_overrides',
  searchWithTime: 'chat.web_search.search_with_time',
  subscribeSources: 'chat.web_search.subscribe_sources',
  compressionMethod: 'chat.web_search.compression.method',
  cutoffLimit: 'chat.web_search.compression.cutoff_limit',
  cutoffUnit: 'chat.web_search.compression.cutoff_unit'
} as const

type WebSearchPreferenceValues = {
  [K in keyof typeof WEB_SEARCH_PREFERENCE_KEYS]: WebSearchPreferenceSnapshot[(typeof WEB_SEARCH_PREFERENCE_KEYS)[K]]
}

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
    return getCachedRendererWebSearchState()
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

  public async getWebSearchProviderAsync(providerId?: string): Promise<WebSearchProvider | undefined> {
    const providers = filterSupportedWebSearchProviders((await getRendererWebSearchState()).providers)
    return providers.find((provider) => provider.id === providerId)
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

    // 截断压缩处理
    if (compressionConfig?.method === 'cutoff' && compressionConfig.cutoffLimit) {
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

export async function updateWebSearchProviderPreferenceOverride(
  providerId: WebSearchProviderId,
  updates: Partial<WebSearchProvider>
): Promise<void> {
  const currentOverrides = await preferenceService.get(WEB_SEARCH_PREFERENCE_KEYS.providerOverrides)
  const nextOverrides = updateWebSearchProviderOverride(currentOverrides ?? {}, providerId, updates)
  await preferenceService.set(WEB_SEARCH_PREFERENCE_KEYS.providerOverrides, nextOverrides)
}

export function buildRendererWebSearchState(preferences: WebSearchPreferenceValues): WebSearchState {
  return {
    defaultProvider: preferences.defaultProvider,
    providers: resolveWebSearchProviders(preferences.providerOverrides),
    searchWithTime: preferences.searchWithTime,
    maxResults: Math.max(1, preferences.maxResults),
    excludeDomains: preferences.excludeDomains,
    subscribeSources: preferences.subscribeSources,
    overwrite: false,
    compressionConfig: {
      method: preferences.compressionMethod,
      cutoffLimit: normalizeWebSearchCutoffLimit(preferences.cutoffLimit),
      cutoffUnit: preferences.cutoffUnit
    }
  }
}

export async function getRendererWebSearchState(): Promise<WebSearchState> {
  const preferences = await preferenceService.getMultiple(WEB_SEARCH_PREFERENCE_KEYS)
  return buildRendererWebSearchState(preferences)
}

export function getCachedRendererWebSearchState(): WebSearchState {
  const getCachedPreference = <K extends PreferenceKeyType>(key: K): PreferenceDefaultScopeType[K] => {
    const cachedValue = preferenceService.getCachedValue(key)
    return (cachedValue !== undefined ? cachedValue : getDefaultValue(key)) as PreferenceDefaultScopeType[K]
  }

  const preferences = Object.fromEntries(
    Object.entries(WEB_SEARCH_PREFERENCE_KEYS).map(([alias, key]) => [alias, getCachedPreference(key)])
  ) as WebSearchPreferenceValues

  return buildRendererWebSearchState(preferences)
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
