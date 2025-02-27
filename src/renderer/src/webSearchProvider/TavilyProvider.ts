import { TavilyClient } from '@agentic/tavily'
import { WebSearchProvider } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

export default class TavilyProvider extends BaseWebSearchProvider {
  private tvly: TavilyClient
  constructor(provider: WebSearchProvider) {
    super(provider)
    this.tvly = new TavilyClient({ apiKey: provider.apiKey })
  }
  public async search(query: string, maxResults: number, excludeDomains: string[]) {
    const result = await this.tvly.search({ query, max_results: maxResults, exclude_domains: excludeDomains })
    console.log('tavily', result)
    return 'tavily'
  }
}
