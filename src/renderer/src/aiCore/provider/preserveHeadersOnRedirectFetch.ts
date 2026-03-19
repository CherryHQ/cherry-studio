const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * Wraps fetch to follow redirects manually so Authorization and custom headers are not dropped
 * when the browser treats the redirect as cross-origin (e.g. same host, http → https).
 */
export function createFetchPreservingHeadersOnRedirect(originalFetch: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const maxHops = 20
    const { url: startUrl, reqInit: startInit } = await toRedirectableArgs(input, init)
    let url = startUrl
    let reqInit = startInit

    for (let hop = 0; hop < maxHops; hop++) {
      const response = await originalFetch(url, {
        ...reqInit,
        redirect: 'manual'
      })

      if (response.type === 'opaqueredirect') {
        return response
      }

      if (!REDIRECT_STATUSES.has(response.status)) {
        return response
      }

      const location = response.headers.get('Location') ?? response.headers.get('location')
      if (!location) {
        return response
      }

      url = new URL(location, url).toString()

      if (response.status === 303) {
        reqInit = {
          ...reqInit,
          method: 'GET',
          body: undefined
        }
        const h = new Headers(reqInit.headers as HeadersInit)
        h.delete('content-type')
        h.delete('Content-Type')
        h.delete('content-length')
        h.delete('Content-Length')
        reqInit.headers = h
      }

      void response.body?.cancel()
    }

    throw new Error('fetch: too many redirects')
  }
}

async function toRedirectableArgs(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ url: string; reqInit: RequestInit }> {
  if (input instanceof Request) {
    const cloned = input.clone()
    const method = (init?.method ?? cloned.method) as string
    const headers = new Headers(cloned.headers)
    if (init?.headers) {
      new Headers(init.headers as HeadersInit).forEach((value, key) => headers.set(key, value))
    }
    let body: BodyInit | null | undefined = init?.body
    if (body === undefined && cloned.body && method !== 'GET' && method !== 'HEAD') {
      body = await cloned.text()
    }
    return {
      url: cloned.url,
      reqInit: {
        method,
        headers,
        body: body ?? undefined,
        signal: init?.signal ?? cloned.signal,
        credentials: init?.credentials ?? cloned.credentials,
        cache: init?.cache ?? cloned.cache,
        mode: init?.mode ?? cloned.mode,
        referrer: init?.referrer ?? cloned.referrer,
        referrerPolicy: init?.referrerPolicy ?? cloned.referrerPolicy,
        integrity: init?.integrity ?? cloned.integrity,
        keepalive: init?.keepalive ?? cloned.keepalive
      }
    }
  }

  const url = typeof input === 'string' ? input : input.href
  return { url, reqInit: { ...init } }
}
