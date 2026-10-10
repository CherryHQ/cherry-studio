/** Conservative KV-cache bytes per context token (repro ~12 GiB at 131072 in #19864). */
export const OLLAMA_KV_BYTES_PER_TOKEN_ESTIMATE = 96_000

/** Agent workloads need more than Ollama's low-VRAM default; never cap below this. */
export const OLLAMA_MIN_NUM_CTX = 4_096

export const OLLAMA_NUM_CTX_CAPS_SHARED_CACHE_KEY = 'ollama.num_ctx_caps'

export function roundDownOllamaNumCtx(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return OLLAMA_MIN_NUM_CTX
  let rounded = OLLAMA_MIN_NUM_CTX
  let step = OLLAMA_MIN_NUM_CTX
  while (step <= value) {
    rounded = step
    step *= 2
  }
  return rounded
}

export interface ResolveOllamaNumCtxInput {
  trainedContextWindow: number
  freeMemoryBytes: number
  totalMemoryBytes: number
  sessionCap?: number | null
}

/** Per-request trained/effective context sizes for Ollama OOM error handling. */
export interface OllamaNumCtxRequestSnapshot {
  /** UniqueModelId of the model this snapshot was resolved for. */
  uniqueModelId: string
  trainedContextWindow: number
  numCtx: number
}

/**
 * Chooses the `num_ctx` Cherry forwards to Ollama: trained window, bounded by RAM and any
 * session cap from a prior OOM retry.
 */
export function resolveOllamaNumCtx({
  trainedContextWindow,
  freeMemoryBytes,
  totalMemoryBytes,
  sessionCap
}: ResolveOllamaNumCtxInput): number {
  if (!Number.isFinite(trainedContextWindow) || trainedContextWindow <= 0) {
    return OLLAMA_MIN_NUM_CTX
  }

  const memoryBudget = Math.max(
    0,
    Math.min(
      Number.isFinite(freeMemoryBytes) ? freeMemoryBytes * 0.5 : 0,
      Number.isFinite(totalMemoryBytes) ? totalMemoryBytes * 0.35 : Number.POSITIVE_INFINITY
    )
  )
  const memoryCap =
    memoryBudget > 0
      ? roundDownOllamaNumCtx(Math.floor(memoryBudget / OLLAMA_KV_BYTES_PER_TOKEN_ESTIMATE))
      : trainedContextWindow

  let effective = Math.min(trainedContextWindow, memoryCap)
  if (sessionCap != null && Number.isFinite(sessionCap) && sessionCap > 0) {
    effective = Math.min(effective, roundDownOllamaNumCtx(sessionCap))
  }
  return Math.min(trainedContextWindow, Math.max(OLLAMA_MIN_NUM_CTX, effective))
}

export function suggestReducedOllamaNumCtx(currentNumCtx: number): number {
  const halved = roundDownOllamaNumCtx(Math.floor(currentNumCtx / 2))
  return Math.max(OLLAMA_MIN_NUM_CTX, halved)
}

/** Budget compaction and context middleware against the window this request actually uses. */
export function resolveEffectiveRequestContextWindow(
  catalogContextWindow: number | undefined,
  requestNumCtx: number | undefined
): number | undefined {
  if (requestNumCtx != null && Number.isFinite(requestNumCtx) && requestNumCtx > 0) {
    if (catalogContextWindow != null && Number.isFinite(catalogContextWindow) && catalogContextWindow > 0) {
      return Math.min(catalogContextWindow, requestNumCtx)
    }
    return requestNumCtx
  }
  return catalogContextWindow
}

const OLLAMA_ALLOCATION_ERROR_PATTERN =
  /\b(?:failed to allocate|cannot allocate|out of memory|oom|cuda out of memory|not enough memory).*(?:kv\s*cache|kvcache)|(?:kv\s*cache|kvcache).*(?:failed|allocate|out of memory|oom|not enough memory)\b/i

export function isOllamaKvCacheAllocationError(text: string): boolean {
  return OLLAMA_ALLOCATION_ERROR_PATTERN.test(text)
}

export function enrichOllamaContextAllocationSerializedError(
  serialized: Record<string, unknown>,
  context?: { trainedContextWindow?: number; effectiveNumCtx?: number; uniqueModelId?: string },
  providerText?: string
): void {
  const text = [
    providerText ?? '',
    typeof serialized.message === 'string' ? serialized.message : '',
    typeof serialized.responseBody === 'string' ? serialized.responseBody : ''
  ].join('\n')
  if (!isOllamaKvCacheAllocationError(text)) return

  serialized.i18nKey = 'ollama_context_memory'
  if (context?.uniqueModelId) serialized.ollamaNumCtxModelId = context.uniqueModelId
  if (context?.trainedContextWindow != null) serialized.ollamaTrainedNumCtx = context.trainedContextWindow
  if (context?.effectiveNumCtx != null) serialized.ollamaEffectiveNumCtx = context.effectiveNumCtx
}
