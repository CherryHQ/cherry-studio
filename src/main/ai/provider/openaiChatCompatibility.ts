import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

// Compatibility policy for observed relay failures, not a general OpenAI capability restriction.
const FUNCTION_TOOL_REASONING_MODEL_IDS = new Set([
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-6-sol',
  'gpt-6-astra',
  'az-gpt-6-luna'
])

const COMPATIBILITY_FETCH_CACHE_SIZE = 10
const compatibilityFetchCache = new WeakMap<typeof globalThis.fetch, Map<string, typeof globalThis.fetch>>()

export function normalizeChatFunctionToolReasoning(
  endpointType: EndpointType | undefined,
  fallbackWireModelId: string,
  body: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  if (endpointType !== ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) return body
  const modelId = typeof body.model === 'string' && body.model.trim() ? body.model : fallbackWireModelId
  if (!FUNCTION_TOOL_REASONING_MODEL_IDS.has(modelId.trim().toLowerCase())) return body
  if (!Array.isArray(body.tools) || !body.tools.some((tool) => tool?.type === 'function')) return body
  const effort = body.reasoning_effort
  if (typeof effort !== 'string' || !effort.trim() || effort.trim().toLowerCase() === 'none') return body
  return { ...body, reasoning_effort: 'none' }
}

export function createChatFunctionToolReasoningFetch(
  innerFetch: typeof globalThis.fetch,
  endpointType: EndpointType | undefined,
  wireModelId: string
): typeof globalThis.fetch {
  if (endpointType !== ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) return innerFetch

  let cachedByModel = compatibilityFetchCache.get(innerFetch)
  if (!cachedByModel) {
    cachedByModel = new Map()
    compatibilityFetchCache.set(innerFetch, cachedByModel)
  }

  const cachedFetch = cachedByModel.get(wireModelId)
  if (cachedFetch) {
    cachedByModel.delete(wireModelId)
    cachedByModel.set(wireModelId, cachedFetch)
    return cachedFetch
  }

  const wrappedFetch: typeof globalThis.fetch = async (input, init) => {
    if (init?.method?.toUpperCase() === 'POST' && typeof init.body === 'string') {
      let body: unknown
      try {
        body = JSON.parse(init.body)
      } catch {
        return innerFetch(input, init)
      }
      if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
        const normalized = normalizeChatFunctionToolReasoning(
          endpointType,
          wireModelId,
          body as Record<string, unknown>
        )
        if (normalized !== body) return innerFetch(input, { ...init, body: JSON.stringify(normalized) })
      }
    }
    return innerFetch(input, init)
  }

  if (cachedByModel.size >= COMPATIBILITY_FETCH_CACHE_SIZE) {
    const oldestKey = cachedByModel.keys().next().value
    if (oldestKey !== undefined) cachedByModel.delete(oldestKey)
  }
  cachedByModel.set(wireModelId, wrappedFetch)
  return wrappedFetch
}
