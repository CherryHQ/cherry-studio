import type { LanguageModelV3Usage } from '@ai-sdk/provider'

export interface FlatV3Usage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
  raw?: LanguageModelV3Usage['raw']
}

export function isFlatV3Usage(usage: unknown): usage is FlatV3Usage {
  if (!usage || typeof usage !== 'object') return false
  const u = usage as Record<string, unknown>
  // V3-nested usage has `inputTokens` as an object; flat has it as a number.
  // Also handle the case where the field is absent (still treat as flat-shaped
  // upstream — V3 nested would carry the empty object).
  return typeof u.inputTokens !== 'object' || u.inputTokens === null
}

export function normalizeFlatV3Usage(flat: FlatV3Usage): LanguageModelV3Usage {
  // `inputTokens` is the OpenAI-compatible prompt total, which already contains
  // `cachedInputTokens`. Deriving the non-cached remainder keeps cost computation
  // from pricing the cached part twice: it falls back to the total when
  // `noCache` is missing and then adds the cache-read bucket on top.
  const cachedInput = flat.cachedInputTokens
  const noCache =
    flat.inputTokens !== undefined && cachedInput !== undefined
      ? Math.max(0, flat.inputTokens - cachedInput)
      : undefined

  return {
    inputTokens: {
      total: flat.inputTokens,
      noCache,
      cacheRead: cachedInput,
      cacheWrite: undefined
    },
    outputTokens: {
      total: flat.outputTokens,
      text: undefined,
      reasoning: flat.reasoningTokens
    },
    ...(flat.raw !== undefined ? { raw: flat.raw } : {})
  }
}

/** Coerce flat provider usage into the nested AI SDK v3 shape expected by persistence. */
export function ensureNestedV3Usage(usage: LanguageModelV3Usage): LanguageModelV3Usage {
  return isFlatV3Usage(usage) ? normalizeFlatV3Usage(usage) : usage
}

export function recordTotalTokens(
  usage: LanguageModelV3Usage,
  inputTokens: number | undefined,
  outputTokens: number | undefined
): number | undefined {
  const flatTotal = isFlatV3Usage(usage) ? usage.totalTokens : undefined
  const summed =
    inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined
  return flatTotal ?? summed
}
