import os from 'node:os'

import { application } from '@application'
import type { Model } from '@shared/data/types/model'
import {
  OLLAMA_NUM_CTX_CAPS_SHARED_CACHE_KEY,
  resolveOllamaNumCtx,
  type ResolveOllamaNumCtxInput
} from '@shared/ai/ollamaNumCtx'

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
