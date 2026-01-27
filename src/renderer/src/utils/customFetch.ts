/**
 * Custom fetch wrapper that preserves User-Agent header for Electron renderer process.
 *
 * In Electron's renderer process, User-Agent is a "forbidden header" that cannot be
 * modified via the Fetch API. This wrapper copies the user-agent header to a custom
 * x-custom-user-agent header, which is then converted back to User-Agent by the
 * main process's onBeforeSendHeaders interceptor.
 */

const originalFetch = globalThis.fetch

export const customFetch: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (init?.headers) {
    const headers = new Headers(init.headers as HeadersInit)
    const ua = headers.get('user-agent')
    if (ua) {
      headers.set('x-custom-user-agent', ua)
    }
    init = { ...init, headers }
  }
  return originalFetch(input, init)
}
