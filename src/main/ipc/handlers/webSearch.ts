import { application } from '@application'
import type { webSearchRequestSchemas } from '@shared/ipc/schemas/webSearch'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the web-search request routes: each one forwards a parsed route
 * call to a `WebSearchService` method (business logic + API-key rotation state stay in
 * that service). These routes act on shared service state, not the caller's window, so
 * they ignore `IpcContext`.
 *
 * `search_keywords` is a provider-check route, so the adapter awaits the service call
 * and discards the WebSearchResponse. `fetch_urls` also backs citation preview, so it
 * returns only preview content while settings callers can still ignore the value. The
 * service methods accept an optional `httpOptions` second argument for in-process
 * (abort-aware) callers; IPC callers never pass it, so the adapters forward only the
 * parsed request.
 */
export const webSearchHandlers: IpcHandlersFor<typeof webSearchRequestSchemas> = {
  'web_search.search_keywords': async (request) => {
    await application.get('WebSearchService').searchKeywords(request)
  },
  'web_search.fetch_urls': async (request) => {
    const response = await application.get('WebSearchService').fetchUrls(request)

    return {
      results: response.results.map((result) => ({ content: result.content }))
    }
  }
}
