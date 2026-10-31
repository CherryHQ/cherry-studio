import { application } from '@application'
import { isWebSearchError } from '@cherrystudio/web-search'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { webSearchErrorCodes } from '@shared/ipc/errors/webSearch'
import type { webSearchRequestSchemas } from '@shared/ipc/schemas/webSearch'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the web-search request routes: each one forwards a parsed route
 * call to a `WebSearchService` method (business logic + API-key rotation state stay in
 * that service). These routes act on shared service state, not the caller's window, so
 * they ignore `IpcContext`.
 *
 * Both routes are `output: z.void()` — the renderer only awaits success/failure for the
 * settings "check" flow. Checks disable provider fallback so a working ExaMCP or Cherry
 * Fetch fallback cannot make a broken selected provider appear healthy.
 */
export const webSearchHandlers: IpcHandlersFor<typeof webSearchRequestSchemas> = {
  'web_search.search_keywords': async (request) => {
    await application.get('WebSearchService').searchKeywords(request, undefined, { fallback: false })
  },
  'web_search.fetch_urls': async (request) => {
    try {
      await application.get('WebSearchService').fetchUrls(request, undefined, { fallback: false })
    } catch (error) {
      if (
        isWebSearchError(error) &&
        error.providerId === 'querit' &&
        error.capability === 'fetchUrls' &&
        error.kind === 'provider' &&
        error.code === 'page_fetch_failed'
      ) {
        throw new IpcError(webSearchErrorCodes.WEB_SEARCH_PAGE_FETCH_FAILED, error.message)
      }
      throw error
    }
  }
}
