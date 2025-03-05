import store from '@renderer/store'
import { setDefaultProvider, WebSearchState } from '@renderer/store/websearch'
import { WebSearchProvider, WebSearchResponse } from '@renderer/types'
import WebSearchEngineProvider from '@renderer/webSearchProvider/WebSearchEngineProvider'

/**
 * 提供网络搜索相关功能的服务类
 */
class WebSearchService {
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
  public isWebSearchEnabled(): boolean {
    const websearch = this.getWebSearchState()
    const provider = websearch.providers.find((provider) => provider.id === websearch.defaultProvider)
    return provider?.enabled ?? false
  }

  /**
   * 获取当前默认的网络搜索提供商
   * @public
   * @returns 网络搜索提供商
   * @throws 如果找不到默认提供商则抛出错误
   */
  public getWebSearchProvider(): WebSearchProvider {
    const websearch = this.getWebSearchState()
    let provider = websearch.providers.find((provider) => provider.id === websearch.defaultProvider)

    if (!provider) {
      provider = websearch.providers.find((p) => p.enabled) || websearch.providers[0]
      if (provider) {
        // 可选：自动更新默认提供商
        store.dispatch(setDefaultProvider(provider.id))
      } else {
        throw new Error(`No web search providers available`)
      }
    }

    return provider
  }

  /**
   * 使用指定的提供商执行网络搜索
   * @public
   * @param provider 搜索提供商
   * @param query 搜索查询
   * @returns 搜索响应
   */
  public async search(provider: WebSearchProvider, query: string): Promise<WebSearchResponse> {
    const websearch = this.getWebSearchState()
    const webSearchEngine = new WebSearchEngineProvider(provider)

    const formattedQuery = query
    // if (websearch.searchWithTime) {
    //   formattedQuery = `today is ${dayjs().format('YYYY-MM-DD')} \r\n ${query}`
    // }

    try {
      return await webSearchEngine.search(formattedQuery, websearch)
    } catch (error) {
      console.error('Search failed:', error)
      return {
        results: []
      }
    }
  }
  /**
   * 检查搜索提供商是否正常工作
   * @public
   * @param provider 要检查的搜索提供商
   * @returns 包含验证结果和错误信息的对象
   */
  public async checkSearch(provider: WebSearchProvider): Promise<{ valid: boolean; error?: Error }> {
    if (!provider) {
      return {
        valid: false,
        error: new Error('No search provider specified')
      }
    }

    try {
      const response = await this.search(provider, 'csdn')

      if (!response || !Array.isArray(response.results)) {
        return {
          valid: false,
          error: new Error('Invalid response format from search provider')
        }
      }

      return {
        valid: response.results.length > 0,
        ...(response.results.length === 0 && {
          error: new Error('Search provider returned no results')
        })
      }
    } catch (error) {
      console.error('Provider check failed:', error)
      return {
        valid: false,
        error: error instanceof Error ? error : new Error('Unknown error occurred')
      }
    }
  }
}
export default new WebSearchService()
