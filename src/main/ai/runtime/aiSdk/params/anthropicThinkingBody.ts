const THINKING_BODY_FETCH_CACHE_SIZE = 10
const thinkingBodyFetchCache = new WeakMap<typeof globalThis.fetch, Map<number | undefined, typeof globalThis.fetch>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeAnthropicThinkingBody(
  body: Record<string, unknown>,
  cap: number | undefined
): Record<string, unknown> {
  if (typeof body.max_tokens !== 'number' || !Number.isFinite(body.max_tokens)) return body
  const maxTokens = cap === undefined ? body.max_tokens : Math.min(body.max_tokens, cap)
  const normalized: Record<string, unknown> = { ...body, max_tokens: maxTokens }
  const thinking = body.thinking
  if (!isRecord(thinking) || thinking.type !== 'enabled') return normalized
  const budget = thinking.budget_tokens
  if (budget !== undefined && (typeof budget !== 'number' || !Number.isInteger(budget) || budget < 1024)) {
    return normalized
  }
  if (maxTokens <= 1024) delete normalized.thinking
  else normalized.thinking = { ...thinking, budget_tokens: Math.min(budget ?? 1024, maxTokens - 1) }
  return normalized
}

/** Correct the serialized body after raw custom parameters and SDK model ceilings have been applied. */
export function createThinkingBodyFetch(
  innerFetch: typeof globalThis.fetch,
  cap: number | undefined
): typeof globalThis.fetch {
  let cachedByCap = thinkingBodyFetchCache.get(innerFetch)
  if (!cachedByCap) {
    cachedByCap = new Map()
    thinkingBodyFetchCache.set(innerFetch, cachedByCap)
  }
  const cachedFetch = cachedByCap.get(cap)
  if (cachedFetch) {
    cachedByCap.delete(cap)
    cachedByCap.set(cap, cachedFetch)
    return cachedFetch
  }

  const wrappedFetch: typeof globalThis.fetch = async (input, init) => {
    if (init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') return innerFetch(input, init)
    let body: unknown
    try {
      body = JSON.parse(init.body)
    } catch {
      return innerFetch(input, init)
    }
    if (!isRecord(body)) return innerFetch(input, init)
    const normalized = normalizeAnthropicThinkingBody(body, cap)
    return innerFetch(input, normalized === body ? init : { ...init, body: JSON.stringify(normalized) })
  }

  if (cachedByCap.size >= THINKING_BODY_FETCH_CACHE_SIZE) {
    const oldest = cachedByCap.keys().next()
    if (!oldest.done) cachedByCap.delete(oldest.value)
  }
  cachedByCap.set(cap, wrappedFetch)
  return wrappedFetch
}
