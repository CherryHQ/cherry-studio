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

/** Observe SSE in the consumer's path, without a tee, extra reader, or retained response body. */
export function withReportedOutputUsage(fetcher: typeof fetch, counts: ReportedOutputUsage): typeof fetch {
  return async (input, init) => {
    delete counts.outputTokens
    delete counts.reasoningTokens
    const response = await fetcher(input, init)
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response
    const decoder = new TextDecoder()
    let line = ''
    let oversized = false
    const observe = (text: string) => {
      for (const character of text) {
        if (character === '\n') {
          if (!oversized && line.startsWith('data:')) {
            try {
              collectReportedOutputUsage(JSON.parse(line.slice(5).trim()), counts)
            } catch {
              /* Non-JSON SSE sentinels are not usage. */
            }
          }
          line = ''
          oversized = false
        } else if (!oversized) {
          line += character
          // Large tool/image payloads are not worth retaining for optional diagnostics.
          if (line.length > 65536) {
            line = ''
            oversized = true
          }
        }
      }
    }
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          observe(decoder.decode(chunk, { stream: true }))
          controller.enqueue(chunk)
        },
        flush() {
          observe(decoder.decode() + '\n')
        }
      })
    )
    const observed = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
    // Reconstructing a Response otherwise loses transport metadata used by SDK diagnostics.
    for (const key of ['url', 'redirected', 'type'] as const)
      Object.defineProperty(observed, key, { value: response[key] })
    return observed
  }
}
