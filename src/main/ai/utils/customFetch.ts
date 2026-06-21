import type { FetchFunction } from '@ai-sdk/provider-utils'
import { net } from 'electron'

/**
 * Base `fetch` for AI provider HTTP calls.
 *
 * Proxy policy is applied centrally by `ProxyManager`
 * (`src/main/services/ProxyManager.ts`), which configures both the Electron
 * session/app proxy and the Node network stack (`src/main/services/proxy`). AI
 * provider traffic intentionally uses Electron
 * `net.fetch` here so it runs on Chromium's network stack and benefits from
 * session-proxy handling (PAC, SOCKS, proxy auth).
 *
 * Shaped as the AI SDK {@link FetchFunction} (`typeof globalThis.fetch`) so it
 * composes as the innermost layer: higher-level wrappers (HTTP trace, provider
 * request signing) take an inner `FetchFunction` and delegate the actual network
 * call to this one.
 */
export const customFetch: FetchFunction = (input: RequestInfo | URL, init?: RequestInit) =>
  // `net.fetch` accepts only `string | Request`; FetchFunction may hand us a URL.
  net.fetch(input instanceof URL ? input.href : input, init)
