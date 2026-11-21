import type { FetchFunction } from '@ai-sdk/provider-utils'

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
 */
export function createExactPathFetch(exactUrl: string, baseFetch: FetchFunction): FetchFunction {
  return (input, init) => {
    if (input instanceof Request) {
      // new Request(url, request) inherits method/headers/body from the source.
      return baseFetch(new Request(exactUrl, input), init)
    }
    return baseFetch(exactUrl, init)
  }
}
