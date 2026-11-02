export const REMOTE_PROVIDER_IDS = Object.freeze([
  'zhipu',
  'tavily',
  'searxng',
  'exa',
  'exa-mcp',
  'bocha',
  'querit',
  'jina',
  'firecrawl',
  'crawl4ai',
  'parallel',
  'serply',
  'yuanbao',
  'deepseek',
  'desearch',
  'searchapi'
] as const)

export type RemoteProviderId = (typeof REMOTE_PROVIDER_IDS)[number]
export type WebSearchCapability = 'searchKeywords' | 'fetchUrls'
export type WebSearchCredentials = Readonly<{
  apiKey?: string
  basicAuth?: Readonly<{ username: string; password: string }>
}>

export type WebSearchProviderMetadata = Readonly<{
  id: RemoteProviderId
  name: string
  type: 'api' | 'mcp'
  capabilities: readonly Readonly<{
    capability: WebSearchCapability
    requiresApiHost: boolean
    defaultApiHost?: string
    apiKey: 'required' | 'optional' | 'unused'
  }>[]
}>

type CallBase = Readonly<{
  providerId: RemoteProviderId
  input: string
  credentials?: WebSearchCredentials
  signal?: AbortSignal
  timeoutMs?: number
}>

export type WebSearchCall = CallBase &
  (
    | {
        capability: 'searchKeywords'
        config: Readonly<{
          apiHost?: string
          maxResults: number
          useDefaultResultCount?: boolean
          engines?: readonly string[]
          excludeDomains?: readonly string[]
        }>
      }
    | { capability: 'fetchUrls'; config: Readonly<{ apiHost?: string; maxCharacters?: number }> }
  )

export type WebSearchResult = Readonly<{
  title: string
  url: string
  content: string
  sourceInput: string
  truncated?: boolean
}>

export type WebSearchResultSet = Readonly<{
  providerId: RemoteProviderId
  capability: WebSearchCapability
  input: string
  results: readonly WebSearchResult[]
}>

export type WebSearchHttpRequest = Readonly<{
  url: string
  method: 'GET' | 'POST'
  headers: Readonly<Record<string, string>>
  body?: string
  signal?: AbortSignal
  timeoutMs?: number
}>

export type WebSearchHttpResponse = Readonly<{
  status: number
  headers: Readonly<Record<string, string>>
  bodyText: string
}>

export interface WebSearchTransport {
  request(request: WebSearchHttpRequest): Promise<WebSearchHttpResponse>
}

export type WebSearchValidationIssue = Readonly<{
  code: string
  path: readonly (string | number)[]
  message: string
}>

export type ProtocolContext = Readonly<{
  call: WebSearchCall
  apiHost: string
  transport: WebSearchTransport
}>

export type WebSearchProviderModule = Readonly<{
  metadata: WebSearchProviderMetadata
  execute(context: ProtocolContext): Promise<readonly WebSearchResult[]>
}>

export type ProviderRegistration = Readonly<{
  provider: WebSearchProviderModule
  capabilities: readonly WebSearchCapability[]
}>

export interface WebSearchClient {
  execute(call: WebSearchCall): Promise<WebSearchResultSet>
}
