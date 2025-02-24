import store from '@renderer/store'
import { WebSearchProvider } from '@renderer/types'
import { tavily } from '@tavily/core'

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
    const provider = this.getWebSearchProvider()
    const tvly = tavily({ apiKey: provider.apiKey })
    return await tvly.search(query, {
      maxResults: 5
    })
  }
}

export default new WebSearchService()
