/**
 * Generic API fetcher for OpenAI-compatible endpoints
 * Handles HTTP requests with timeout and error handling
 */

export interface FetchOptions {
  url: string
  headers?: Record<string, string>
  timeout?: number
}

export class BaseFetcher<TResponse = any> {
  /**
   * Fetch data from an API endpoint
   * @param options Fetch configuration
   * @returns Parsed JSON response
   */
  async fetch(options: FetchOptions): Promise<TResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeout || 30000)

    try {
      const response = await fetch(options.url, {
        headers: options.headers,
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }

      return (await response.json()) as TResponse
    } finally {
      clearTimeout(timeout)
    }
  }
}
