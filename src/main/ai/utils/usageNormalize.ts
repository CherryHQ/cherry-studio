import { isJSONObject, type LanguageModelV3Usage } from '@ai-sdk/provider'
import * as z from 'zod'

const flatV3UsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  reasoningTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  raw: z.custom<NonNullable<LanguageModelV3Usage['raw']>>(isJSONObject).optional()
})

export type FlatV3Usage = z.infer<typeof flatV3UsageSchema>

// Gateway SDK forwards usage without validation, so the legacy probe checks the full flat shape.
export function isFlatV3Usage(usage: unknown): usage is FlatV3Usage {
  return flatV3UsageSchema.safeParse(usage).success
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

  const usage: LanguageModelV3Usage = {
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
    }
  }
  if (flat.raw !== undefined) Object.assign(usage, { raw: flat.raw })
  return usage
}

/** Coerce flat provider usage into the nested AI SDK v3 shape expected by persistence. */
export function ensureNestedV3Usage(usage: LanguageModelV3Usage | FlatV3Usage): LanguageModelV3Usage {
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- Even nominal SDK usage can be legacy flat data; the boundary guard validates every flat counter before conversion.
  return isFlatV3Usage(usage) ? normalizeFlatV3Usage(usage) : usage
}

export function recordTotalTokens(
  usage: LanguageModelV3Usage | FlatV3Usage,
  inputTokens: number | undefined,
  outputTokens: number | undefined
): number | undefined {
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- SDK typing does not validate the network usage shape; read totalTokens only after the legacy flat schema accepts it.
  const flatTotal = isFlatV3Usage(usage) ? usage.totalTokens : undefined
  const summed =
    inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined
  return flatTotal ?? summed
}
