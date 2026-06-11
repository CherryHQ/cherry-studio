/**
 * Web search / fetch core — runtime-agnostic.
 *
 * Single source of truth for "look something up on the web" shared by the
 * AI-SDK builtin tools (`web_search` / `web_fetch`) and the Claude Code
 * in-process MCP bridge. Both runtimes are thin formatters over these
 * functions; the provider is resolved inside `WebSearchService` from the
 * user's configured default for each capability.
 *
 * Never throws on lookup failure: a failed lookup returns `{ error }` so the
 * surrounding agentic loop (AI-SDK or Claude Code) keeps running instead of
 * aborting. A cancellation (aborted signal) is the exception — it rethrows, so
 * it propagates as the cancellation it is rather than a retryable error.
 */

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { isPermanentWebSearchConfigError } from '@main/services/webSearch/utils/config'
import { isAbortError } from '@main/services/webSearch/utils/errors'
import type { WebSearchOutput } from '@shared/ai/builtinTools'
import type { WebSearchResponse } from '@shared/data/types/webSearch'
import * as z from 'zod'

const logger = loggerService.withContext('WebLookup')

export const WEB_SEARCH_DESCRIPTION = `Search the web for current information, news, and real-time data.

Use this when:
- The user asks about recent events, current prices, or live data
- You need to verify facts you're uncertain about or that may have changed
- The user references something you don't have context on

Don't use for:
- Math, code reasoning, or things you can answer from your training
- Well-known facts unlikely to have changed

You may call this multiple times with different queries to broaden coverage:
- If the topic likely has more authoritative sources in another language
  (English for tech / scientific topics, the local language for regional news,
  Japanese for anime / manga, etc.), repeat the search with the topic translated
  into the most likely source language.
- If the first results miss an angle, refine with synonyms or sub-aspects.

Cite sources by [id] in your final answer.`

export const WEB_FETCH_DESCRIPTION = `Fetch the readable content from one or more known web page URLs.

Use this when:
- You already have specific URLs from the user, prior context, or web_search
- You need page content from an article, documentation page, or reference URL
- Search snippets are not enough and you need the source page text

Don't use this when you only have a topic or question; call web_search first.

Cite sources by [id] in your final answer.`

/**
 * A failed lookup must be distinguishable from "ran fine, found nothing": both
 * would otherwise be `[]`. Success returns the results array (matching
 * `webSearchOutputSchema`); failure returns `{ error }`.
 */
export const webLookupErrorSchema = z.object({ error: z.string() })
export type WebLookupError = z.infer<typeof webLookupErrorSchema>
export type WebLookupResult = WebSearchOutput | WebLookupError

/** Transient failure (network/provider hiccup) — a retry can succeed. Covers web_search and web_fetch. */
export const WEB_LOOKUP_ERROR_NOTE = 'Web lookup failed (network/provider error); retry or inform the user.'

/**
 * Permanent failure: no usable web-search provider for the requested capability — either none is
 * configured, or the configured one doesn't support it (`getProviderForCapability` throws for both;
 * see {@link isPermanentWebSearchConfigError}). Retrying can never succeed — the user has to fix the
 * config — so the note must steer away from a retry loop.
 */
export const WEB_PROVIDER_NOT_CONFIGURED_NOTE =
  'No usable web search provider for this capability (none configured, or the configured one does not support it). Tell the user to configure one in Settings (Web Search); do not retry — it cannot succeed until then.'

/** Branch the model-facing note: a permanent provider-config failure can't be retried; everything else is. */
function webLookupNote(error: string): string {
  return isPermanentWebSearchConfigError(error) ? WEB_PROVIDER_NOT_CONFIGURED_NOTE : WEB_LOOKUP_ERROR_NOTE
}

export function isWebLookupError(output: WebLookupResult): output is WebLookupError {
  // Success is always the results array; the error object is the only non-array shape. (A non-strict
  // zod object-parse would misclassify a future object-shaped success that happened to carry `error`.)
  return !Array.isArray(output)
}

/** Shared model-output projection: an error renders the matching note; results pass through as json. */
export function webLookupModelOutput(
  output: WebLookupResult
): { type: 'text'; value: string } | { type: 'json'; value: WebSearchOutput } {
  if (isWebLookupError(output)) {
    return { type: 'text', value: webLookupNote(output.error) }
  }
  return { type: 'json', value: output }
}

function mapResponse(response: WebSearchResponse): WebSearchOutput {
  return response.results.map((result, index) => ({
    id: index + 1,
    title: result.title,
    url: result.url,
    content: result.content
  }))
}

export async function searchWeb(query: string, signal?: AbortSignal): Promise<WebLookupResult> {
  try {
    const response = await application.get('WebSearchService').searchKeywords({ keywords: [query] }, { signal })
    return mapResponse(response)
  } catch (error) {
    // A cancellation isn't a provider failure — rethrow so it propagates instead of looking like a
    // retryable error that keeps the tool loop running after the request was already aborted.
    if (signal?.aborted || isAbortError(error)) throw error
    logger.error('webSearchService.searchKeywords failed', error as Error, { query })
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function fetchWeb(urls: string[], signal?: AbortSignal): Promise<WebLookupResult> {
  try {
    const response = await application.get('WebSearchService').fetchUrls({ urls }, { signal })
    return mapResponse(response)
  } catch (error) {
    // A cancellation isn't a provider failure — rethrow so it propagates instead of looking like a
    // retryable error that keeps the tool loop running after the request was already aborted.
    if (signal?.aborted || isAbortError(error)) throw error
    logger.error('webSearchService.fetchUrls failed', error as Error, { urls })
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
