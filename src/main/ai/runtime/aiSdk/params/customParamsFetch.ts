import { t } from '@main/i18n'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

import { isCustomProviderNamespace } from '../../../utils/options'

const CUSTOM_PARAMS_FETCH_CACHE_SIZE = 10
const customParamsFetchCache = new WeakMap<typeof globalThis.fetch, Map<string, typeof globalThis.fetch>>()

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
  return Object.fromEntries(
    Object.entries(providerParams).filter(([key]) => !isCustomProviderNamespace(key, providerOptions, rawProviderId))
  )
}

/**
 * Re-inject raw custom parameters after an AI SDK provider has serialized its
 * schema-filtered request body. SDK-produced fields keep higher precedence.
 */
export function createCustomParamsFetch(
  innerFetch: typeof globalThis.fetch,
  customParams: Record<string, unknown>,
  endpointType: EndpointType
): typeof globalThis.fetch {
  if (Object.keys(customParams).length === 0) return innerFetch

  const serializedCustomParams = JSON.stringify(customParams) ?? '{}'
  const cacheKey = JSON.stringify([endpointType, serializedCustomParams])
  let cachedByParams = customParamsFetchCache.get(innerFetch)
  if (!cachedByParams) {
    cachedByParams = new Map()
    customParamsFetchCache.set(innerFetch, cachedByParams)
  }

  const cachedFetch = cachedByParams.get(cacheKey)
  if (cachedFetch) {
    cachedByParams.delete(cacheKey)
    cachedByParams.set(cacheKey, cachedFetch)
    return cachedFetch
  }

  const customParamsSnapshot = JSON.parse(serializedCustomParams) as Record<string, unknown>
  const wrappedFetch: typeof globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method?.toUpperCase() === 'POST' && typeof init.body === 'string') {
      let body: unknown
      try {
        body = JSON.parse(init.body)
      } catch {
        return innerFetch(input, init)
      }

      if (isRecord(body)) {
        const mergedBody = { ...customParamsSnapshot, ...body }
        const thinking = mergedBody.thinking
        if (
          endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES &&
          Object.hasOwn(mergedBody, 'thinking') &&
          isRecord(thinking) &&
          thinking.type === 'adaptive' &&
          Object.hasOwn(thinking, 'budget_tokens')
        ) {
          const error = new Error(t('error.adaptive_thinking_budget'))
          error.name = 'InvalidAdaptiveThinkingBudgetError'
          throw error
        }
        return innerFetch(input, {
          ...init,
          body: JSON.stringify(mergedBody)
        })
      }
    }

    return innerFetch(input, init)
  }

  if (cachedByParams.size >= CUSTOM_PARAMS_FETCH_CACHE_SIZE) {
    const oldestKey = cachedByParams.keys().next().value
    if (oldestKey !== undefined) cachedByParams.delete(oldestKey)
  }
  cachedByParams.set(cacheKey, wrappedFetch)
  return wrappedFetch
}
