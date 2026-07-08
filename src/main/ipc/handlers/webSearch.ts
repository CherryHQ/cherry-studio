import { application } from '@application'
import type { webSearchRequestSchemas } from '@shared/ipc/schemas/webSearch'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the web-search request routes: each one forwards a parsed route
 * call to a `WebSearchService` method (business logic + API-key rotation state stay in
 * that service). These routes act on shared service state, not the caller's window, so
 * they ignore `IpcContext`.
 *
 * The settings "check" routes are `output: z.void()` — the renderer only awaits
 * success/failure, so those adapters await the service call (propagating errors) and
 * discard the WebSearchResponse. Citation preview uses the same fetch service but
 * returns the first result so the renderer can load page bodies on demand. The service
 * methods accept an optional `httpOptions` second argument for in-process (abort-aware)
 * callers; IPC callers never pass it, so the adapters forward only the parsed request.
 */
export const webSearchHandlers: IpcHandlersFor<typeof webSearchRequestSchemas> = {
  'web_search.search_keywords': async (request) => {
    await application.get('WebSearchService').searchKeywords(request)
  },
  'web_search.fetch_urls': async (request) => {
    await application.get('WebSearchService').fetchUrls(request)
  },
  'web_search.fetch_url_preview': async ({ url }) => {
    const response = await application.get('WebSearchService').fetchUrls({ urls: [url] })
    return (
      response.results[0] ?? {
        title: url,
        url,
        content: '',
        sourceInput: url
      }
    )
  }
}
