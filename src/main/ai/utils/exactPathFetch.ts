import type { FetchFunction } from '@ai-sdk/provider-utils'

import { redactUrlParams } from '@shared/utils/redaction'

/**
 * Exact request-path transport for endpoint configs that declare
 * `pathMode: 'complete'` (see `EndpointConfigSchema`). The AI SDK builds
 * request URLs as `<baseURL>/<default endpoint path>`; for a complete-path
 * host whose path is not one of the SDK's known endpoint suffixes, that
 * append would break the user's declared URL. This wrapper pins every request
 * the SDK issues through the provider to the exact stored URL, preserving
 * method, headers and body.
 *
 * Only the request URL is rewritten — auth, proxy handling, tracing and any
 * builder-installed body transforms still run in the wrapped fetch.
 *
 * On failure the error's `url` is set to the effective (pinned) path so
 * request diagnostics describe the route that was actually called rather than
 * the path the SDK tried to build; `redactUrlParams` strips sensitive query
 * values and downstream error context redacts credentials.
 */
export function createExactPathFetch(exactUrl: string, baseFetch: FetchFunction): FetchFunction {
  return async (input, init) => {
    try {
      if (input instanceof Request) {
        // new Request(url, request) inherits method/headers/body from the source.
        return await baseFetch(new Request(exactUrl, input), init)
      }
      return await baseFetch(exactUrl, init)
    } catch (error) {
      if (typeof error === 'object' && error !== null) {
        try {
          ;(error as { url?: string }).url = redactUrlParams(exactUrl)
        } catch {
          // Non-extensible error object: leave the diagnostics untouched.
        }
      }
      throw error
    }
  }
}
