/** Transient count provenance. Null means the upstream count was not reported. */
export interface ProviderReportedOutputUsage {
  outputTokens: number | null
  reasoningTokens: number | null
}

/** Internal gateway extension, separate from normalized protocol usage/billing totals. */
export const REPORTED_OUTPUT_USAGE_KEY = 'cherry_reported_output_usage'

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Read raw upstream usage when available, before provider adapters fill missing buckets. */
export function providerReportedOutputUsage(usage: {
  raw?: unknown
  outputTokens?: number
  outputTokenDetails?: { reasoningTokens?: number }
}): ProviderReportedOutputUsage {
  const raw = usage.raw
  if (typeof raw !== 'object' || raw === null) {
    return {
      outputTokens: count(usage.outputTokens),
      reasoningTokens: count(usage.outputTokenDetails?.reasoningTokens)
    }
  }
  const wire = raw as Record<string, unknown>
  const details = wire.completion_tokens_details ?? wire.output_tokens_details
  const breakdown = typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : undefined
  const candidates = count(wire.candidatesTokenCount)
  const thoughts = count(wire.thoughtsTokenCount)
  const canonical = count(wire.completion_tokens)
  const alias = count(wire.output_tokens) ?? count(wire.outputTokens)
  const normalized = count(usage.outputTokens)
  const rawOutput = canonical ?? alias ?? (candidates === null ? null : candidates + (thoughts ?? 0))
  let outputTokens: number | null
  if (Array.isArray(wire.iterations) && rawOutput === null && normalized !== null) {
    // Anthropic reports executor totals through iterations alone; the adapter already summed them.
    outputTokens = normalized
  } else if (canonical === null && alias !== null) {
    // Streams merge message_start's initial count into raw usage. An adapter that found no terminal
    // count leaves its normalized count undefined, so the merged initial value is not a final count.
    // A compatible endpoint that sends only the alias gets its normalized count filled with zero, so
    // the wire alias is the reported value.
    outputTokens = normalized === null ? null : alias
  } else {
    outputTokens = rawOutput === null ? null : (normalized ?? rawOutput)
  }
  return {
    // Raw fields establish presence, while the provider adapter owns semantics:
    // xAI Chat adds reasoning to completion_tokens; OpenAI includes it already.
    outputTokens,
    reasoningTokens:
      count(breakdown?.reasoning_tokens) ??
      count(breakdown?.thinking_tokens) ??
      count(wire.reasoning_tokens) ??
      thoughts
  }
}
