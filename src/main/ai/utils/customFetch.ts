import type { FetchFunction } from '@ai-sdk/provider-utils'
import { net, session } from 'electron'

/**
 * Sentinel header that carries a caller-supplied `User-Agent` past Chromium's
 * network stack.
 *
 * `customFetch` issues requests through Electron `net.fetch`, which runs on the
 * Chromium stack and overwrites the `User-Agent` request header with the
 * session default — so a provider's custom `User-Agent` (set via
 * `provider.settings.extraHeaders`) never reaches the wire. We instead carry the
 * desired value in this non-restricted header and swap it back onto `User-Agent`
 * inside {@link installProviderUserAgentInterceptor}'s `onBeforeSendHeaders`
 * hook — the one place Electron lets the outbound UA be set on the Chromium stack
 * (mirrors `WebviewService.initSessionUserAgent`).
 */
const PROVIDER_USER_AGENT_HEADER = 'x-cherry-studio-user-agent'

/**
 * Symbol-keyed slot carried on a `RequestInit` between the HTTP-trace wrapper
 * (`createHttpTraceFetch`) and this innermost fetch. Provider fetch wrappers
 * rewrite the body (DashScope web_extractor, Ark include-stripping, Codex/Grok
 * body coercion) between the two, so the trace would otherwise record the
 * pre-transform request. `customFetch` writes the final on-wire body here; the
 * trace reads it back and overwrites its `inputs` attribute.
 */
export const HTTP_TRACE_FINAL_BODY_SLOT: unique symbol = Symbol('httpTrace.finalBody')

/** Slot value stored under {@link HTTP_TRACE_FINAL_BODY_SLOT}. */
export interface HttpTraceFinalBodySlot {
  /** The body this request actually sent. */
  body?: BodyInit | null
}

/**
 * Resolve the effective `User-Agent` from a {@link HeadersInit} with
 * case-insensitive last-writer-wins.
 *
 * A plain header object can hold case variants of the same name — e.g. Copilot's
 * default `User-Agent` plus a lowercase `user-agent` from `extraHeaders` after a
 * `{ ...defaults, ...extraHeaders }` merge. `new Headers(...).get('user-agent')`
 * would comma-join them (`"Copilot/1.0, MyAgent/1.0"`), losing the override; here
 * the last entry wins, matching the merge's `extraHeaders`-precedence.
 */
function resolveUserAgent(headers: HeadersInit): string | null {
  if (headers instanceof Headers) return headers.get('user-agent')
  const entries = Array.isArray(headers) ? headers : Object.entries(headers)
  let userAgent: string | null = null
  for (const [key, value] of entries) {
    if (key.toLowerCase() === 'user-agent') userAgent = value
  }
  return userAgent
}

/**
 * Base `fetch` for AI provider HTTP calls.
 *
 * Proxy policy is applied centrally by `ProxyService`
 * (`src/main/services/proxy/ProxyService.ts`), which configures both the Electron
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
export const customFetch: FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => {
  // `net.fetch` accepts only `string | Request`; FetchFunction may hand us a URL.
  const target = input instanceof URL ? input.href : input

  // Record the final on-wire body for the HTTP-trace layer (see
  // HTTP_TRACE_FINAL_BODY_SLOT). Innermost means the body here is the one really
  // sent — after every provider transform — so the trace can correct its span.
  const finalBodySlot = (init as { [HTTP_TRACE_FINAL_BODY_SLOT]?: HttpTraceFinalBodySlot } | undefined)?.[
    HTTP_TRACE_FINAL_BODY_SLOT
  ]
  if (finalBodySlot) finalBodySlot.body = init?.body

  // A custom `User-Agent` in the request headers is overwritten by Chromium's net
  // stack, so smuggle it through PROVIDER_USER_AGENT_HEADER and let the default-session
  // interceptor restore it. Only the (string, init) call shape carries headers here;
  // the AI SDK always uses it, so the Request-input path needs no handling.
  const userAgent = init?.headers ? resolveUserAgent(init.headers) : null
  if (userAgent) {
    const headers = new Headers(init?.headers)
    headers.set(PROVIDER_USER_AGENT_HEADER, userAgent)
    return net.fetch(target, { ...init, headers })
  }

  return net.fetch(target, init)
}

/**
 * Install the default-session `onBeforeSendHeaders` interceptor that restores a
 * provider `User-Agent` smuggled through {@link PROVIDER_USER_AGENT_HEADER}.
 *
 * `net.fetch` issues on `session.defaultSession`, so this is where its requests
 * pass through. The hook is a pass-through for every other request; it only
 * rewrites headers carrying the sentinel. Returns a disposer that removes the
 * interceptor.
 *
 * Owns the default session's single `onBeforeSendHeaders` slot — nothing else may
 * register one on `defaultSession` (Electron keeps only the latest listener).
 */
export function installProviderUserAgentInterceptor(): () => void {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const sentinelKey = Object.keys(details.requestHeaders).find(
      (key) => key.toLowerCase() === PROVIDER_USER_AGENT_HEADER
    )
    if (!sentinelKey) {
      callback({ requestHeaders: details.requestHeaders })
      return
    }

    const userAgent = details.requestHeaders[sentinelKey]
    const requestHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(details.requestHeaders)) {
      const lower = key.toLowerCase()
      // Drop the sentinel and Chromium's default UA; the latter is re-added below.
      if (lower === PROVIDER_USER_AGENT_HEADER || lower === 'user-agent') continue
      requestHeaders[key] = value
    }
    requestHeaders['User-Agent'] = userAgent
    callback({ requestHeaders })
  })

  return () => session.defaultSession.webRequest.onBeforeSendHeaders(null)
}
