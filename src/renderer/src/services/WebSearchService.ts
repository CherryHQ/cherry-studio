import store from '@renderer/store'
import { WebSearchProvider } from '@renderer/types'
import { tavily } from '@tavily/core'
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

  public async search(query: string) {
    const searchWithTime = store.getState().websearch.searchWithTime
    const maxResults = store.getState().websearch.maxResults
    const excludeDomains = store.getState().websearch.excludeDomains
    let formatted_query = query
    if (searchWithTime) {
      formatted_query = `today is ${dayjs().format('YYYY-MM-DD')} \r\n ${query}`
    }
    const provider = this.getWebSearchProvider()
    const tvly = tavily({ apiKey: provider.apiKey })
    const result = await tvly.search(formatted_query, {
      maxResults: maxResults,
      excludeDomains: excludeDomains
    })

    return result
  }
}

export default new WebSearchService()
