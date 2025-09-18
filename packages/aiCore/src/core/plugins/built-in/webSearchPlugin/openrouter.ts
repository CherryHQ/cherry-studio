export type OpenRouterSearchConfig = {
  plugins?: Array<{
    id: 'web'
    /**
     * Maximum number of search results to include (default: 5)
     */
    max_results?: number
    /**
     * Custom search prompt to guide the search query
     */
    search_prompt?: string
  }>
  /**
   * Built-in web search options for models that support native web search
   */
  web_search_options?: {
    /**
     * Maximum number of search results to include
     */
    max_results?: number
    /**
     * Custom search prompt to guide the search query
     */
    search_prompt?: string
  }
}
