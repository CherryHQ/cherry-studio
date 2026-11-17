export { createWebSearchClient } from './createWebSearchClient'
export { REMOTE_PROVIDER_IDS } from './types'
export type {
  ProviderRegistration,
  RemoteProviderId,
  WebSearchCall,
  WebSearchCapability,
  WebSearchClient,
  WebSearchCredentials,
  WebSearchFetchUrlsCall,
  WebSearchHttpRequest,
  WebSearchHttpResponse,
  WebSearchImageResult,
  WebSearchImageResultSet,
  WebSearchKeywordsCall,
  WebSearchProviderMetadata,
  WebSearchProviderModule,
  WebSearchResult,
  WebSearchResultSet,
  WebSearchSearchImagesCall,
  WebSearchTransport,
  WebSearchValidationIssue
} from './types'
export { validateWebSearchCall } from './validation'
export { isWebSearchError, WebSearchError, WebSearchTransportError } from './WebSearchError'
export type { WebSearchErrorInfo, WebSearchErrorKind } from './WebSearchError'
