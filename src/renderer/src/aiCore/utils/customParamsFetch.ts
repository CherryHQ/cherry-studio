/**
 * Fetch wrapper that re-injects custom provider parameters into the outgoing
 * HTTP request body.
 *
 * ## Why this exists
 *
 * AI SDK provider adapters (e.g. `@ai-sdk/openai`, `@ai-sdk/anthropic`) use zod
 * schemas with default **strip** behavior inside their `getArgs()` method.
 * Any custom parameter that is not in the adapter's whitelist is silently
 * removed and never reaches the HTTP body — even though Cherry Studio correctly
 * placed it in `providerOptions[providerId]`.
 *
 * This wrapper bypasses the adapter layer by merging the raw custom params back
 * into the JSON body at the fetch level, **after** the adapter has already
 * constructed and serialized the body.
 *
 * ## Precedence
 *
 * Custom params are merged with **low precedence**: if the SDK already set a
 * field in the body (because it IS whitelisted), the SDK-computed value always
 * wins. This prevents a user's raw param from overwriting the SDK's
 * type-converted / camelCase-mapped value.
 *
 * @param innerFetch - The underlying fetch function to delegate to (may already
 *                     be wrapped by other middleware such as CherryAI signature
 *                     or HTTP trace).
 * @param customParams - Flat key-value map of provider-specific custom params
 *                       prepared specifically for top-level body passthrough.
 */
export function createCustomParamsFetch(
  innerFetch: typeof globalThis.fetch,
  customParams: Record<string, unknown>
): typeof globalThis.fetch {
  if (!customParams || Object.keys(customParams).length === 0) {
    return innerFetch
  }

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body)
        if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
          // Low precedence: existing body values always win over custom params.
          const merged: Record<string, unknown> = { ...customParams, ...body }
          return innerFetch(input, { ...init, body: JSON.stringify(merged) })
        }
      } catch {
        // Body is not valid JSON (e.g. multipart form) — pass through unchanged.
      }
    }
    return innerFetch(input, init)
  }
}
