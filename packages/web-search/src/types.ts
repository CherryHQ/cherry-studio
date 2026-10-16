export type WebSearchProviderId =
  | 'zhipu'
  | 'tavily'
  | 'searxng'
  | 'exa'
  | 'exa-mcp'
  | 'bocha'
  | 'querit'
  | 'jina'
  | 'firecrawl'
  | 'crawl4ai'
  | 'parallel'
  | 'serply'
export type WebSearchCapability = 'searchKeywords' | 'fetchUrls'
export type WebSearchCredentials = Readonly<{ apiKey?: string; basicAuthUsername?: string; basicAuthPassword?: string }>
export type WebSearchConfig = Readonly<{
  apiHost?: string
  maxResults?: number
  engines?: readonly string[]
  excludeDomains?: readonly string[]
}>
export type WebSearchExecuteRequest = Readonly<{
  providerId: WebSearchProviderId
  input: string
  credentials?: WebSearchCredentials
  signal?: AbortSignal
  timeoutMs?: number
}> &
  (
    | { capability: 'searchKeywords'; config: WebSearchConfig & Readonly<{ maxResults: number }> }
    | { capability: 'fetchUrls'; config: WebSearchConfig }
  )
export type WebSearchResult = Readonly<{
  title: string
  url: string
  content: string
  sourceInput: string
  truncated?: boolean
}>
export type WebSearchResultSet = Readonly<{
  providerId: WebSearchProviderId
  capability: WebSearchCapability
  input: string
  results: readonly WebSearchResult[]
}>
export type WebSearchTransport = {
  request(request: {
    url: string
    method: 'GET' | 'POST'
    headers: Readonly<Record<string, string>>
    body?: string
    signal?: AbortSignal
    timeoutMs?: number
  }): Promise<{ status: number; headers: Readonly<Record<string, string>>; bodyText: string }>
}
export type WebSearchCapabilityMetadata = Readonly<{
  capability: WebSearchCapability
  requiresApiHost: boolean
  requiresApiKey: boolean
  defaultApiHost?: string
}>
export type WebSearchProviderMetadata = Readonly<{
  id: WebSearchProviderId
  name: string
  type: 'api' | 'mcp'
  capabilities: readonly WebSearchCapabilityMetadata[]
}>
export type WebSearchProviderModule = Readonly<{
  metadata: WebSearchProviderMetadata
  execute(request: WebSearchExecuteRequest, transport: WebSearchTransport): Promise<WebSearchResultSet>
}>
export type WebSearchProviderRegistration = Readonly<{
  provider: WebSearchProviderModule
  capabilities: readonly WebSearchCapability[]
}>
export type WebSearchClient = Readonly<{ execute(request: WebSearchExecuteRequest): Promise<WebSearchResultSet> }>
