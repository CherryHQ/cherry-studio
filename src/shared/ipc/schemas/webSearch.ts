import { WebSearchProviderIdSchema } from '@shared/data/presets/webSearchProviders'
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
 * `search_keywords` is used only by provider checks and returns `output:
 * z.void()`. `fetch_urls` is also used by citation preview, so it returns only
 * the fetched preview content that renderer callers consume.
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

const fetchUrlsResponseSchema = z.object({
  results: z.array(
    z.object({
      content: z.string()
    })
  )
})

// ── Request: renderer→main calls (zod values, always parsed) ──
export const webSearchRequestSchemas = {
  'web_search.search_keywords': defineRoute({ input: searchKeywordsRequestSchema, output: z.void() }),
  'web_search.fetch_urls': defineRoute({ input: fetchUrlsRequestSchema, output: fetchUrlsResponseSchema })
}
