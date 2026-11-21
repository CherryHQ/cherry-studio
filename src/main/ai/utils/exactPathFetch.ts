import type { FetchFunction } from '@ai-sdk/provider-utils'

import { redactUrlParams } from '@shared/utils/redaction'

import { HTTP_TRACE_FINAL_BODY_SLOT, type HttpTraceFinalBodySlot } from './customFetch'

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
 * Thrown transport errors receive a redacted URL here. SDK-created errors
 * are corrected after adapter execution by exactPathDiagnostics middleware.
 */
export function createExactPathFetch(exactUrl: string, baseFetch: FetchFunction): FetchFunction {
  return async (input, init) => {
    const traceSlot = (init as { [HTTP_TRACE_FINAL_BODY_SLOT]?: HttpTraceFinalBodySlot } | undefined)?.[
      HTTP_TRACE_FINAL_BODY_SLOT
    ]
    if (traceSlot) traceSlot.url = exactUrl
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
