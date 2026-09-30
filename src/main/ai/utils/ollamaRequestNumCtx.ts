import os from 'node:os'

import { application } from '@application'
import {
  OLLAMA_NUM_CTX_CAPS_SHARED_CACHE_KEY,
  resolveOllamaNumCtx,
  type ResolveOllamaNumCtxInput
} from '@shared/ai/ollamaNumCtx'
import type { Model } from '@shared/data/types/model'

export interface OllamaNumCtxResolution extends ResolveOllamaNumCtxInput {
  numCtx: number
}

function readSessionCap(model: Model): number | null | undefined {
  try {
    const caps = application.get('CacheService').getShared(OLLAMA_NUM_CTX_CAPS_SHARED_CACHE_KEY)
    return caps?.[model.id]
  } catch {
    return undefined
  }
}

export function resolveOllamaRequestNumCtx(model: Model): OllamaNumCtxResolution | undefined {
  const trainedContextWindow = model.contextWindow
  if (!trainedContextWindow || trainedContextWindow <= 0) return undefined

  const input: ResolveOllamaNumCtxInput = {
    trainedContextWindow,
    freeMemoryBytes: os.freemem(),
    totalMemoryBytes: os.totalmem(),
    sessionCap: readSessionCap(model)
  }
  return { ...input, numCtx: resolveOllamaNumCtx(input) }
}

/**
 * Lowers a model's session `num_ctx` cap after a KV-cache OOM retry. The renderer's
 * "retry with smaller context" delegates here so the read-merge-write happens in one
 * owner — synchronous, so concurrent IPC calls cannot interleave — and a stale or
 * concurrent retry can never raise an already-lowered cap.
 */
export function lowerOllamaNumCtxCap(uniqueModelId: string, cap: number): void {
  const cache = application.get('CacheService')
  const caps = cache.getShared(OLLAMA_NUM_CTX_CAPS_SHARED_CACHE_KEY)
  const current = caps?.[uniqueModelId]
  if (typeof current === 'number' && current <= cap) return
  cache.setShared(OLLAMA_NUM_CTX_CAPS_SHARED_CACHE_KEY, { ...caps, [uniqueModelId]: cap })
}
