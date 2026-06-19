import type { FetchFunction } from '@ai-sdk/provider-utils'
import { net } from 'electron'

/**
 * Base `fetch` for AI provider HTTP calls, routed through Electron's `net.fetch`.
 *
 * `net.fetch` issues requests on Chromium's network stack, so it honours the app
 * proxy configured by `ProxyManager` via `session.setProxy()` / `app.setProxy()`
 * (see `src/main/services/proxy`). Node's `globalThis.fetch` (undici) only obeys
 * the separately-patched undici dispatcher, so provider requests must go through
 * this to pick up the session proxy consistently.
 *
 * Shaped as the AI SDK {@link FetchFunction} (`typeof globalThis.fetch`) so it
 * composes as the innermost layer: higher-level wrappers (HTTP trace, provider
 * request signing) take an inner `FetchFunction` and delegate the actual network
 * call to this one.
 */
export const customFetch: FetchFunction = (input: RequestInfo | URL, init?: RequestInit) =>
  // `net.fetch` accepts only `string | Request`; FetchFunction may hand us a URL.
  net.fetch(input instanceof URL ? input.href : input, init)
