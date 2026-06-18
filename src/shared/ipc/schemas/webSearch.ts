import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import {
  WebSearchCapabilitySchema,
  WebSearchProviderIdSchema,
  WebSearchProviderTypeSchema
} from '@shared/data/presets/web-search-providers'
import type {
  WebSearchCheckProviderRequest,
  WebSearchCheckProviderResponse,
  WebSearchFetchUrlsRequest,
  WebSearchResponse,
  WebSearchResult,
  WebSearchSearchKeywordsRequest
} from '@shared/data/types/webSearch'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Web-search IPC schemas — caller-facing runtime operations that delegate to the
 * stateful WebSearchService in main (which owns API-key rotation across calls).
 *
 * Only a Request block: these are zod *values* (renderer→main, untrusted → always
 * parsed). The web-search domain pushes nothing main→renderer, so there is no Event
 * block (unlike window.ts/selection.ts).
 *
 * The request/response TS types live in `@shared/data/types/webSearch` as plain types
 * (no canonical zod), so each schema is bound to its type with `z.ZodType<X>` — a drift
 * in either is then a compile error here at the definition (repo convention — see
 * uiParts.ts / legacyFileMetadata.ts, ipc-migration-guide.md "Mirroring an Existing Type").
 */

const searchKeywordsRequestSchema: z.ZodType<WebSearchSearchKeywordsRequest> = z.strictObject({
  providerId: WebSearchProviderIdSchema.optional(),
  keywords: z.array(z.string())
})

const fetchUrlsRequestSchema: z.ZodType<WebSearchFetchUrlsRequest> = z.strictObject({
  providerId: WebSearchProviderIdSchema.optional(),
  urls: z.array(z.string())
})

/**
 * Runtime form of the {@link WebSearchProvider} preference type — the full,
 * possibly-unsaved provider config the settings UI passes to `check_provider`.
 */
const webSearchProviderSchema: z.ZodType<WebSearchProvider> = z.strictObject({
  id: WebSearchProviderIdSchema,
  name: z.string(),
  type: WebSearchProviderTypeSchema,
  apiKeys: z.array(z.string()),
  capabilities: z.array(
    z.strictObject({
      feature: WebSearchCapabilitySchema,
      apiHost: z.string().optional()
    })
  ),
  engines: z.array(z.string()),
  basicAuthUsername: z.string(),
  basicAuthPassword: z.string()
})

const checkProviderRequestSchema: z.ZodType<WebSearchCheckProviderRequest> = z.strictObject({
  provider: webSearchProviderSchema,
  capability: WebSearchCapabilitySchema.optional()
})

const webSearchResultSchema: z.ZodType<WebSearchResult> = z.strictObject({
  title: z.string(),
  content: z.string(),
  url: z.string(),
  sourceInput: z.string()
})

const webSearchResponseSchema: z.ZodType<WebSearchResponse> = z.strictObject({
  query: z.string().optional(),
  providerId: WebSearchProviderIdSchema,
  capability: WebSearchCapabilitySchema,
  inputs: z.array(z.string()),
  results: z.array(webSearchResultSchema)
})

const checkProviderResponseSchema: z.ZodType<WebSearchCheckProviderResponse> = z.strictObject({
  valid: z.boolean(),
  error: z.string().optional()
})

// ── Request: renderer→main calls (zod values, always parsed) ──
export const webSearchRequestSchemas = {
  'web_search.search_keywords': defineRoute({ input: searchKeywordsRequestSchema, output: webSearchResponseSchema }),
  'web_search.fetch_urls': defineRoute({ input: fetchUrlsRequestSchema, output: webSearchResponseSchema }),
  'web_search.check_provider': defineRoute({ input: checkProviderRequestSchema, output: checkProviderResponseSchema })
}
