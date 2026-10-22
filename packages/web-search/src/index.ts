export { createWebSearchClient } from './createWebSearchClient'
export { REMOTE_PROVIDER_IDS } from './types'
export type {
  ProviderRegistration,
  RemoteProviderId,
  WebSearchCall,
  WebSearchCapability,
  WebSearchClient,
  WebSearchCredentials,
  WebSearchHttpRequest,
  WebSearchHttpResponse,
  WebSearchProviderMetadata,
  WebSearchProviderModule,
  WebSearchResult,
  WebSearchResultSet,
  WebSearchTransport,
  WebSearchValidationIssue
} from './types'
export { validateWebSearchCall } from './validation'
export { isWebSearchError, WebSearchError, WebSearchTransportError } from './WebSearchError'
export type { WebSearchErrorInfo, WebSearchErrorKind } from './WebSearchError'
