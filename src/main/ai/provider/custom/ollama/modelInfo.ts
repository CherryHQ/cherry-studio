import {
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  postJsonToApi,
  zodSchema
} from '@ai-sdk/provider-utils'
import { providerService } from '@main/data/services/ProviderService'
import { defaultAppHeaders } from '@main/utils/http'
import type { Provider } from '@shared/data/types/provider'
import { formatOllamaApiHost } from '@shared/utils/api'
import * as z from 'zod'

import { getBaseUrl, getExtraHeaders } from '../../../utils/provider'

const OllamaShowResponseSchema = z.looseObject({
  model_info: z.record(z.string(), z.unknown()).optional()
})

const OllamaErrorSchema = z.looseObject({
  error: z.string().optional(),
  message: z.string().optional()
})

const OLLAMA_MODEL_INFO_CACHE_TTL_MS = 5 * 60 * 1000
const contextWindowCache = new Map<string, { value: number; expiresAt: number }>()

/** Ollama namespaces this key by architecture (for example `gemma3.context_length`). */
export function extractOllamaContextWindow(modelInfo: Record<string, unknown> | undefined): number | undefined {
  if (!modelInfo) return undefined

  const architecture = modelInfo['general.architecture']
  if (typeof architecture === 'string') {
    const declared = modelInfo[`${architecture}.context_length`]
    return Number.isSafeInteger(declared) && (declared as number) > 0 ? (declared as number) : undefined
  }

  const candidates = Object.entries(modelInfo)
    .filter(([key, value]) => key.endsWith('.context_length') && Number.isSafeInteger(value) && (value as number) > 0)
    .map(([, value]) => value as number)

  return candidates.length > 0 ? Math.max(...candidates) : undefined
}

/**
 * Resolve an Ollama model's native context window without loading the model.
 * Successful lookups are cached briefly; failures remain retryable and tag updates
 * are picked up without requiring an app restart.
 */
export async function resolveOllamaModelContextWindow(
  provider: Provider,
  modelApiId: string,
  options?: { signal?: AbortSignal; apiKeyOverride?: string }
): Promise<number | undefined> {
  const baseUrl = formatOllamaApiHost(getBaseUrl(provider))
  const cacheKey = `${baseUrl}\n${modelApiId}`
  const cached = contextWindowCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  contextWindowCache.delete(cacheKey)

  const contextWindow = await fetchOllamaModelContextWindow(provider, modelApiId, baseUrl, options)
  if (contextWindow !== undefined) {
    contextWindowCache.set(cacheKey, {
      value: contextWindow,
      expiresAt: Date.now() + OLLAMA_MODEL_INFO_CACHE_TTL_MS
    })
  }
  return contextWindow
}

async function fetchOllamaModelContextWindow(
  provider: Provider,
  modelApiId: string,
  baseUrl: string,
  options?: { signal?: AbortSignal; apiKeyOverride?: string }
): Promise<number | undefined> {
  const apiKey =
    options?.apiKeyOverride !== undefined
      ? providerService.resolveApiKey(provider.id, options.apiKeyOverride).value
      : providerService.getRotatedApiKey(provider.id)
  const headers = {
    ...defaultAppHeaders(),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}`, 'X-Api-Key': apiKey } : {}),
    ...getExtraHeaders(provider)
  }
  const { value } = await postJsonToApi({
    url: `${baseUrl}/show`,
    headers,
    body: { model: modelApiId, verbose: false },
    successfulResponseHandler: createJsonResponseHandler(zodSchema(OllamaShowResponseSchema)),
    failedResponseHandler: createJsonErrorResponseHandler({
      errorSchema: zodSchema(OllamaErrorSchema),
      errorToMessage: (error) => error.error ?? error.message ?? 'Unknown Ollama error'
    }),
    abortSignal: options?.signal
  })

  return extractOllamaContextWindow(value.model_info)
}
