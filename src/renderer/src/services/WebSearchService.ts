import Logger from '@renderer/config/logger'
import i18n from '@renderer/i18n'
import WebSearchEngineProvider from '@renderer/providers/WebSearchProvider'
import store from '@renderer/store'
import { CompressionConfig, WebSearchState } from '@renderer/store/websearch'
import {
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeReference,
  WebSearchProvider,
  WebSearchProviderResponse,
  WebSearchProviderResult
} from '@renderer/types'
import { hasObjectKey, uuid } from '@renderer/utils'
import { addAbortController } from '@renderer/utils/abortController'
import { formatErrorMessage } from '@renderer/utils/error'
import { ExtractResults } from '@renderer/utils/extract'
import { fetchWebContents } from '@renderer/utils/fetch'
import dayjs from 'dayjs'
import { LRUCache } from 'lru-cache'

import { getKnowledgeBaseParams } from './KnowledgeService'
import { getKnowledgeSourceUrl, searchKnowledgeBase } from './KnowledgeService'

interface RequestState {
  signal: AbortSignal | null
  searchBase?: KnowledgeBase
  isPaused: boolean
  createdAt: number
}

/**
 * 提供网络搜索相关功能的服务类
 */
class WebSearchService {
  /**
   * 是否暂停
   */
  private signal: AbortSignal | null = null

  isPaused = false

  // 管理不同请求的状态
  private requestStates = new LRUCache<string, RequestState>({
    max: 5, // 最多5个并发请求
    ttl: 1000 * 60 * 2, // 2分钟过期
    dispose: (requestState: RequestState, requestId: string) => {
      if (!requestState.searchBase) return
      window.api.knowledgeBase
        .delete(requestState.searchBase.id)
        .catch((error) => Logger.warn(`[WebSearchService] Failed to cleanup search base for ${requestId}:`, error))
    }
  })

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
    return store.getState().websearch
  }

  /**
   * 检查网络搜索功能是否启用
   * @public
   * @returns 如果默认搜索提供商已启用则返回true，否则返回false
   */
  public isWebSearchEnabled(providerId?: WebSearchProvider['id']): boolean {
    const { providers } = this.getWebSearchState()
    const provider = providers.find((provider) => provider.id === providerId)

    if (!provider) {
      return false
    }

    if (provider.id.startsWith('local-')) {
      return true
    }

    if (hasObjectKey(provider, 'apiKey')) {
      return provider.apiKey !== ''
    }

    if (hasObjectKey(provider, 'apiHost')) {
      return provider.apiHost !== ''
    }

    return false
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
    const { providers } = this.getWebSearchState()
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
    httpOptions?: RequestInit
  ): Promise<WebSearchProviderResponse> {
    const websearch = this.getWebSearchState()
    const webSearchEngine = new WebSearchEngineProvider(provider)

    let formattedQuery = query
    // FIXME: 有待商榷，效果一般
    if (websearch.searchWithTime) {
      formattedQuery = `today is ${dayjs().format('YYYY-MM-DD')} \r\n ${query}`
    }

    // try {
    return await webSearchEngine.search(formattedQuery, websearch, httpOptions)
    // } catch (error) {
    //   console.error('Search failed:', error)
    //   throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    // }
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
      Logger.log('[checkSearch] Search response:', response)
      // 优化的判断条件：检查结果是否有效且没有错误
      return { valid: response.results !== undefined, error: undefined }
    } catch (error) {
      return { valid: false, error }
    }
  }

  /**
   * 确保搜索压缩知识库存在并配置正确
   */
  private async ensureSearchBase(
    config: CompressionConfig,
    searchCount: number,
    requestId: string
  ): Promise<KnowledgeBase> {
    const baseId = `websearch-compression-${requestId}`
    const state = this.getRequestState(requestId)

    // 如果已存在且配置未变，直接复用
    if (state.searchBase && this.isConfigMatched(state.searchBase, config)) {
      return state.searchBase
    }

    // 清理旧的知识库
    if (state.searchBase) {
      await window.api.knowledgeBase.delete(state.searchBase.id)
    }

    if (!config.embeddingModel || !config.embeddingDimensions) {
      throw new Error('Embedding model and dimensions are required for RAG compression')
    }

    // 根据搜索次数计算所需的文档数量（默认为 3，取小一点）
    const documentCount = Math.max(0, searchCount) * (config.documentCount ?? 3)

    // 创建新的知识库
    state.searchBase = {
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

    // 更新LRU cache
    this.requestStates.set(requestId, state)

    // 创建知识库
    const baseParams = getKnowledgeBaseParams(state.searchBase)
    await window.api.knowledgeBase.create(baseParams)

    return state.searchBase
  }

  /**
   * 检查配置是否匹配
   */
  private isConfigMatched(base: KnowledgeBase, config: CompressionConfig): boolean {
    return (
      base.model.id === config.embeddingModel?.id &&
      base.rerankModel?.id === config.rerankModel?.id &&
      base.dimensions === config.embeddingDimensions
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
    config: CompressionConfig,
    requestId: string
  ): Promise<WebSearchProviderResult[]> {
    const query = questions.join(' | ')
    const searchBase = await this.ensureSearchBase(config, rawResults.length, requestId)

    // 1. 清空知识库
    await window.api.knowledgeBase.reset(getKnowledgeBaseParams(searchBase))

    // 2. 一次性添加所有搜索结果到知识库
    const addPromises = rawResults.map(async (result) => {
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
    })

    // 等待所有结果添加完成
    await Promise.all(addPromises)

    // 3. 在知识库中搜索获取压缩结果并转换格式
    const retrievedResults = await searchKnowledgeBase(query, searchBase)
    const references: KnowledgeReference[] = await Promise.all(
      retrievedResults.map(async (result, index) => ({
        id: index + 1,
        content: result.pageContent,
        sourceUrl: await getKnowledgeSourceUrl(result),
        type: 'url' as const
      }))
    )

    Logger.log('[WebSearchService] With RAG, the number of search results:', {
      raw: rawResults.length,
      retrieved: retrievedResults.length
    })

    // 4. 按 sourceUrl 分组并合并同源片段
    const urlToOriginalResult = new Map(rawResults.map((result) => [result.url, result]))
    const sourceGroupMap = new Map<
      string,
      {
        originalResult: WebSearchProviderResult
        contents: string[]
      }
    >()

    // 分组：将同源的检索片段归类
    for (const reference of references) {
      const originalResult = urlToOriginalResult.get(reference.sourceUrl)
      if (originalResult) {
        if (!sourceGroupMap.has(reference.sourceUrl)) {
          sourceGroupMap.set(reference.sourceUrl, {
            originalResult,
            contents: []
          })
        }
        sourceGroupMap.get(reference.sourceUrl)!.contents.push(reference.content)
      }
    }

    // 合并：每个原始搜索结果最多产生一个压缩结果
    const compressedResults: WebSearchProviderResult[] = []
    for (const [, group] of sourceGroupMap) {
      compressedResults.push({
        title: group.originalResult.title,
        url: group.originalResult.url,
        content: group.contents.join('\n\n---\n\n') // 用分隔符合并多个片段
      })
    }

    return compressedResults
  }

  public async processWebsearch(
    webSearchProvider: WebSearchProvider,
    extractResults: ExtractResults,
    requestId?: string
  ): Promise<WebSearchProviderResponse> {
    // 检查 websearch 和 question 是否有效
    if (!extractResults.websearch?.question || extractResults.websearch.question.length === 0) {
      Logger.log('[processWebsearch] No valid question found in extractResults.websearch')
      return { results: [] }
    }

    const questions = extractResults.websearch.question
    const links = extractResults.websearch.links
    const firstQuestion = questions[0]
    if (firstQuestion === 'summarize' && links && links.length > 0) {
      // 使用请求特定的signal，如果没有则回退到全局signal
      const signal = requestId ? this.getRequestState(requestId).signal || this.signal : this.signal
      const contents = await fetchWebContents(links, undefined, undefined, { signal })
      return {
        query: 'summaries',
        results: contents
      }
    }

    // 使用请求特定的signal，如果没有则回退到全局signal
    const signal = requestId ? this.getRequestState(requestId).signal || this.signal : this.signal

    const searchPromises = questions.map((q) => this.search(webSearchProvider, q, { signal }))
    const searchResults = await Promise.allSettled(searchPromises)
    const aggregatedResults: any[] = []

    searchResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        if (result.value.results) {
          aggregatedResults.push(...result.value.results)
        }
      }
      if (result.status === 'rejected') {
        throw result.reason
      }
    })

    const websearch = this.getWebSearchState()

    // RAG压缩处理
    if (websearch.compressionConfig?.method === 'rag' && requestId) {
      try {
        const compressedResults = await this.compressWithSearchBase(
          questions,
          aggregatedResults,
          websearch.compressionConfig,
          requestId
        )
        return {
          query: questions.join(' | '),
          results: compressedResults
        }
      } catch (error) {
        Logger.warn('[WebSearchService] RAG compression failed, will return empty results:', error)
        window.message.error({
          key: 'websearch-rag-failed',
          duration: 10,
          content: `[${i18n.t('settings.websearch.compression.error.rag_failed')}]: ${formatErrorMessage(error)}`
        })
        return {
          query: questions.join(' | '),
          results: []
        }
      }
    }

    // 不压缩的情况下，在此处统一应用 contentLimit
    if (websearch.contentLimit) {
      const perResultLimit = Math.floor(websearch.contentLimit / aggregatedResults.length)
      return {
        query: questions.join(' | '),
        results: aggregatedResults.map((result) => ({
          ...result,
          content:
            result.content.length > perResultLimit ? result.content.slice(0, perResultLimit) + '...' : result.content
        }))
      }
    }

    return {
      query: questions.join(' | '),
      results: aggregatedResults
    }
  }
}

export default new WebSearchService()
