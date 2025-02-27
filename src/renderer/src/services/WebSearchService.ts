import store from '@renderer/store'
import { WebSearchProvider } from '@renderer/types'
import WebSearchEngineProvider from '@renderer/webSearchProvider/WebSearchEngineProvider'
import dayjs from 'dayjs'

class WebSearchService {
  public isWebSearchEnabled(): boolean {
    const defaultProvider = store.getState().websearch.defaultProvider
    const providers = store.getState().websearch.providers
    const provider = providers.find((provider) => provider.id === defaultProvider)
    return provider?.apiKey ? true : false
  }

  public getWebSearchProvider(): WebSearchProvider {
    const defaultProvider = store.getState().websearch.defaultProvider
    const providers = store.getState().websearch.providers
    const provider = providers.find((provider) => provider.id === defaultProvider)

    if (!provider) {
      throw new Error(`Web search provider with id ${defaultProvider} not found`)
    }

    return provider
  }

  public async search(provider: WebSearchProvider, query: string) {
    const webSearchEngine = new WebSearchEngineProvider(provider)
    const searchWithTime = store.getState().websearch.searchWithTime
    const maxResults = store.getState().websearch.maxResults
    const excludeDomains = store.getState().websearch.excludeDomains
    let formatted_query = query
    if (searchWithTime) {
      formatted_query = `today is ${dayjs().format('YYYY-MM-DD')} \r\n ${query}`
    }
    const result = await webSearchEngine.search(formatted_query, maxResults, excludeDomains)

    return result
  }
}

export default new WebSearchService()
