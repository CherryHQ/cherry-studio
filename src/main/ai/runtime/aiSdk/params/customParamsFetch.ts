function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Keep flat custom parameters for HTTP-body passthrough while excluding
 * provider-scoped option bags that only belong inside `providerOptions`.
 */
export function selectCustomBodyParameters(
  providerParams: Record<string, unknown>,
  providerOptions: Record<string, Record<string, unknown>>,
  rawProviderId: string
): Record<string, unknown> {
  const providerNamespaces = new Set([...Object.keys(providerOptions), rawProviderId])
  return Object.fromEntries(
    Object.entries(providerParams).filter(([key, value]) => !(providerNamespaces.has(key) && isRecord(value)))
  )
}

/**
 * Re-inject raw custom parameters after an AI SDK provider has serialized its
 * schema-filtered request body. SDK-produced fields keep higher precedence.
 */
export function createCustomParamsFetch(
  innerFetch: typeof globalThis.fetch,
  customParams: Record<string, unknown>
): typeof globalThis.fetch {
  if (Object.keys(customParams).length === 0) return innerFetch

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method?.toUpperCase() === 'POST' && typeof init.body === 'string') {
      let body: unknown
      try {
        body = JSON.parse(init.body)
      } catch {
        return innerFetch(input, init)
      }

      if (isRecord(body)) {
        return innerFetch(input, {
          ...init,
          body: JSON.stringify({ ...customParams, ...body })
        })
      }
    }

    return innerFetch(input, init)
  }
}
