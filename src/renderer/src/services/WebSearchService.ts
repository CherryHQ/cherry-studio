import { loggerService } from '@logger'
import WebSearchEngineProvider from '@renderer/providers/WebSearchProvider'
import store from '@renderer/store'
import type { WebSearchState } from '@renderer/store/websearch'
import type { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'
import { hasObjectKey } from '@renderer/utils'
import dayjs from 'dayjs'

const logger = loggerService.withContext('WebSearchService')

/**
 * 提供网络搜索相关功能的服务类
 */
export class WebSearchService {
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
   * 获取当前默认的网络搜索提供商
   * @public
   * @returns 网络搜索提供商
   */
  public getWebSearchProvider(providerId?: string): WebSearchProvider | undefined {
    const { providers } = this.getWebSearchState()
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

    let formattedQuery = query
    // FIXME: 有待商榷，效果一般
    if (websearch.searchWithTime) {
      formattedQuery = `today is ${dayjs().format('YYYY-MM-DD')} \r\n ${query}`
    }

    return await webSearchEngine.search(formattedQuery, websearch, httpOptions)
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
}

export const webSearchService = new WebSearchService()
