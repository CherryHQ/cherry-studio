import type { FetchFunction } from '@ai-sdk/provider-utils'

/**
 * Base `fetch` for AI provider HTTP calls.
 *
 * Proxy policy is applied centrally by `ProxyManager`
 * (`src/main/services/ProxyManager.ts`), which configures both the Electron
 * session/app proxy and the Node network stack (`src/main/services/proxy`).
 * Provider traffic must use Node/undici `fetch`, not Electron `net.fetch`:
 * https://github.com/electron/electron/issues/42244 confirms `net.fetch` can
 * throw uncaught errors when a server returns non-ASCII response headers, which
 * is common on CN gateways.
 *
 * Shaped as the AI SDK {@link FetchFunction} (`typeof globalThis.fetch`) so it
 * composes as the innermost layer: higher-level wrappers (HTTP trace, provider
 * request signing) take an inner `FetchFunction` and delegate the actual network
 * call to this one.
 */
export const customFetch: FetchFunction = (input: RequestInfo | URL, init?: RequestInit) =>
  globalThis.fetch(input, init)
