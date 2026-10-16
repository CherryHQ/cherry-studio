export type {
  WebSearchProviderId,
  WebSearchCapability,
  WebSearchCredentials,
  WebSearchConfig,
  WebSearchExecuteRequest,
  WebSearchResult,
  WebSearchResultSet,
  WebSearchTransport,
  WebSearchCapabilityMetadata,
  WebSearchProviderMetadata,
  WebSearchProviderModule,
  WebSearchProviderRegistration,
  WebSearchClient
} from './types'
export { createWebSearchClient } from './client'
export { WebSearchError, WebSearchTransportError } from './errors'
export type { WebSearchErrorKind, WebSearchErrorDetails } from './errors'
