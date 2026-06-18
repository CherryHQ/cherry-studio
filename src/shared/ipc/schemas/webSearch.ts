import { WebSearchProviderIdSchema } from '@shared/data/presets/web-search-providers'
import type { WebSearchFetchUrlsRequest, WebSearchSearchKeywordsRequest } from '@shared/data/types/webSearch'
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
 * Both routes return `output: z.void()`: the sole renderer caller
 * (useWebSearchProviderCheck) only awaits success/failure and never reads the
 * WebSearchResponse, and the code that does consume a response (webLookup.ts) calls
 * WebSearchService in-process, not over IPC — so the result is meaningless to IPC
 * callers (see ipc-migration-guide.md, "Return Values: void When Meaningless").
 *
 * The request TS types live in `@shared/data/types/webSearch` as plain types (no
 * canonical zod), so each input schema is bound to its type with `z.ZodType<X>` — a
 * drift in either is then a compile error here at the definition (repo convention —
 * see uiParts.ts / legacyFileMetadata.ts, ipc-migration-guide.md "Mirroring an
 * Existing Type"). Inputs use `z.object` (extras are stripped), matching window.ts /
 * selection.ts.
 */

const searchKeywordsRequestSchema: z.ZodType<WebSearchSearchKeywordsRequest> = z.object({
  providerId: WebSearchProviderIdSchema.optional(),
  keywords: z.array(z.string())
})

const fetchUrlsRequestSchema: z.ZodType<WebSearchFetchUrlsRequest> = z.object({
  providerId: WebSearchProviderIdSchema.optional(),
  urls: z.array(z.string())
})

// ── Request: renderer→main calls (zod values, always parsed) ──
export const webSearchRequestSchemas = {
  'web_search.search_keywords': defineRoute({ input: searchKeywordsRequestSchema, output: z.void() }),
  'web_search.fetch_urls': defineRoute({ input: fetchUrlsRequestSchema, output: z.void() })
}
