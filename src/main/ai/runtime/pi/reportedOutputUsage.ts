import type { StreamOptions } from '@earendil-works/pi-ai'

/** Raw wire counts, captured before SDK adapters fill absent fields with zero. */
export interface ReportedOutputUsage {
  outputTokens?: number
  reasoningTokens?: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
export function collectReportedOutputUsage(value: unknown, counts: ReportedOutputUsage): void {
  const chunk = record(value)
  if (!chunk) return
  const choices = Array.isArray(chunk.choices) ? chunk.choices : []
  const usage =
    record(chunk.usage) ??
    record(record(chunk.response)?.usage) ??
    record(record(chunk.message)?.usage) ??
    record(record(choices[0])?.usage)
  if (usage) {
    const output = count(usage.completion_tokens) ?? count(usage.output_tokens)
    const details = record(usage.completion_tokens_details) ?? record(usage.output_tokens_details)
    const reasoning = count(details?.reasoning_tokens) ?? count(details?.thinking_tokens)
    if (output !== undefined) counts.outputTokens = output
    if (reasoning !== undefined) counts.reasoningTokens = reasoning
  }
  const google = record(chunk.usageMetadata)
  if (google) {
    const output = count(google.candidatesTokenCount)
    const reasoning = count(google.thoughtsTokenCount)
    if (output !== undefined) counts.outputTokens = output + (reasoning ?? 0)
    if (reasoning !== undefined) counts.reasoningTokens = reasoning
  }
}

/** Compose the SDK's read-only pre-normalization hook without retaining response content. */
export function reportedOutputUsageObserver(
  counts: ReportedOutputUsage,
  previous?: StreamOptions['onProviderStreamEvent']
): NonNullable<StreamOptions['onProviderStreamEvent']> {
  return async (data, model) => {
    collectReportedOutputUsage(data, counts)
    await previous?.(data, model)
  }
}
