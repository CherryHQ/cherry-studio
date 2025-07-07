import { DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT } from '@renderer/config/constant'
import Logger from '@renderer/config/logger'
import i18n from '@renderer/i18n'
import WebSearchEngineProvider from '@renderer/providers/WebSearchProvider'
import store from '@renderer/store'
import { setWebSearchStatus } from '@renderer/store/runtime'
import { CompressionConfig, WebSearchState } from '@renderer/store/websearch'
import {
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeReference,
  WebSearchProvider,
  WebSearchProviderResponse,
  WebSearchProviderResult,
  WebSearchStatus
} from '@renderer/types'
import { hasObjectKey, uuid } from '@renderer/utils'
import { addAbortController } from '@renderer/utils/abortController'
import { formatErrorMessage } from '@renderer/utils/error'
import { ExtractResults } from '@renderer/utils/extract'
import { fetchWebContents } from '@renderer/utils/fetch'
import { consolidateReferencesByUrl, selectReferences } from '@renderer/utils/websearch'
import dayjs from 'dayjs'
import { LRUCache } from 'lru-cache'
import { sliceByTokens } from 'tokenx'

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
   * 设置网络搜索状态
   */
  private async setWebSearchStatus(requestId: string, status: WebSearchStatus, delayMs?: number) {
    store.dispatch(setWebSearchStatus({ requestId, status }))
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  /**
   * 确保搜索压缩知识库存在并配置正确
   */
  private async ensureSearchBase(
    config: CompressionConfig,
    documentCount: number,
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

    if (!config.embeddingModel) {
      throw new Error('Embedding model is required for RAG compression')
    }

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

    // 3. 去重，保留最高分的重复内容
    const seen = new Set<string>()
    const uniqueResults = flatResults.filter((item) => {
      if (seen.has(item.pageContent)) {
        return false
      }
      seen.add(item.pageContent)
      return true
    })

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
    config: CompressionConfig,
    requestId: string
  ): Promise<WebSearchProviderResult[]> {
    // 根据搜索次数计算所需的文档数量
    const totalDocumentCount =
      Math.max(0, rawResults.length) * (config.documentCount ?? DEFAULT_WEBSEARCH_RAG_DOCUMENT_COUNT)

    const searchBase = await this.ensureSearchBase(config, totalDocumentCount, requestId)

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

    // 3. 对知识库执行多问题搜索获取压缩结果
    const references = await this.querySearchBase(questions, searchBase)

    // 4. 使用 Round Robin 策略选择引用
    const selectedReferences = selectReferences(rawResults, references, totalDocumentCount)

    Logger.log('[WebSearchService] With RAG, the number of search results:', {
      raw: rawResults.length,
      retrieved: references.length,
      selected: selectedReferences.length
    })

    // 5. 按 sourceUrl 分组并合并同源片段
    return consolidateReferencesByUrl(rawResults, selectedReferences)
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
    config: CompressionConfig
  ): Promise<WebSearchProviderResult[]> {
    if (!config.cutoffLimit) {
      Logger.warn('[WebSearchService] Cutoff limit is not set, skipping compression')
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
      Logger.log('[processWebsearch] No valid question found in extractResults.websearch')
      return { results: [] }
    }

    // 使用请求特定的signal，如果没有则回退到全局signal
    const signal = this.getRequestState(requestId).signal || this.signal

    const questions = extractResults.websearch.question
    const links = extractResults.websearch.links

    // 处理 summarize
    if (questions[0] === 'summarize' && links && links.length > 0) {
      const contents = await fetchWebContents(links, undefined, undefined, { signal })
      return { query: 'summaries', results: contents }
    }

    const searchPromises = questions.map((q) => this.search(webSearchProvider, q, { signal }))
    const searchResults = await Promise.allSettled(searchPromises)

    // 统计成功完成的搜索数量
    const successfulSearchCount = searchResults.filter((result) => result.status === 'fulfilled').length
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

    // 如果没有搜索结果，直接返回空结果
    if (finalResults.length === 0) {
      await this.setWebSearchStatus(requestId, { phase: 'default' })
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
        Logger.warn('[WebSearchService] RAG compression failed, will return empty results:', error)
        window.message.error({
          key: 'websearch-rag-failed',
          duration: 10,
          content: `${i18n.t('settings.tool.websearch.compression.error.rag_failed')}: ${formatErrorMessage(error)}`
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

    return {
      query: questions.join(' | '),
      results: finalResults
    }
  }
}

export default new WebSearchService()
