import { application } from '@application'
import type { webSearchRequestSchemas } from '@shared/ipc/schemas/webSearch'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the web-search request routes: each one forwards a parsed route
 * call to a `WebSearchService` method (business logic + API-key rotation state stay in
 * that service). These routes act on shared service state, not the caller's window, so
 * they ignore `IpcContext`.
 *
 * Both routes are `output: z.void()` — the renderer only awaits success/failure (the
 * settings "check" flow), so the adapters await the service call (propagating errors)
 * and discard the WebSearchResponse. The service methods accept an optional
 * `httpOptions` second argument for in-process (abort-aware) callers; IPC callers never
 * pass it, so the adapters forward only the parsed request.
 */
export const webSearchHandlers: IpcHandlersFor<typeof webSearchRequestSchemas> = {
  'web_search.search_keywords': async (request) => {
    await application.get('WebSearchService').searchKeywords(request)
  },
  'web_search.fetch_urls': async (request) => {
    await application.get('WebSearchService').fetchUrls(request)
  }
}
