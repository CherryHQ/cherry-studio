/**
 * Some providers hand back the raw SSE frame their error arrived on instead of
 * the decoded payload, e.g.
 *
 *   API Error: Request rejected (429) · event:error data:{"type":"error","error":{"type":"rate_limit_error","message":"..."}}
 *
 * Rendering that verbatim puts protocol scaffolding (`event:error data:{...}`)
 * in the user's message. Recover the provider's own message plus the structured
 * fields the frame carries, so classification still sees the status and the UI
 * shows prose.
 */

const DATA_FRAME_PATTERN = /\bdata:\s*(\{[\s\S]*\})/i
const MAX_FRAME_CHARS = 16_384

export interface SseErrorFrame {
  /** The provider's own message, taken from the frame's error envelope. */
  message?: string
  /** Provider error `type` (e.g. `rate_limit_error`). */
  type?: string
  /** Provider error `code` (e.g. `rate_limit_exceeded`). */
  code?: string
  /** HTTP status recovered from the frame or from the prose around it. */
  statusCode?: number
}

function textOf(value: unknown, max = 500): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

/** Read a bounded-cardinality string field off a parsed JSON object. */
function fieldOf(source: Record<string, unknown>, key: string): string | undefined {
  const direct = textOf(source[key])
  if (direct) return direct
  const nested = source[key]
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return textOf((nested as Record<string, unknown>).message)
  }
  return undefined
}

function statusOf(source: Record<string, unknown>): number | undefined {
  for (const key of ['status', 'statusCode', 'code'] as const) {
    const value = source[key]
    if (typeof value === 'number' && value >= 400 && value <= 599) return value
  }
  return undefined
}

/**
 * Pull an SSE error frame out of free-form error text.
 * Returns `undefined` when the text holds no decodable frame, so callers keep
 * the original text rather than degrading it.
 */
export function extractSseErrorFrame(text: string): SseErrorFrame | undefined {
  if (typeof text !== 'string' || !text.includes('data:')) return undefined
  const match = DATA_FRAME_PATTERN.exec(text)
  if (!match) return undefined
  if (match[1].length > MAX_FRAME_CHARS) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(match[1])
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>

  const envelope =
    record.error && typeof record.error === 'object' && !Array.isArray(record.error)
      ? (record.error as Record<string, unknown>)
      : undefined

  const message = (envelope && textOf(envelope.message)) ?? textOf(record.message)
  const type = (envelope && fieldOf(envelope, 'type')) ?? fieldOf(record, 'type')
  const code = (envelope && fieldOf(envelope, 'code')) ?? fieldOf(record, 'code')
  const statusCode =
    (envelope && statusOf(envelope)) ??
    statusOf(record) ??
    // The frame is usually glued onto prose that already names the status: "Request rejected (429)".
    statusFromProse(text)

  if (!message && !type && !code && statusCode === undefined) return undefined
  return {
    ...(message ? { message } : {}),
    ...(type ? { type } : {}),
    ...(code ? { code } : {}),
    ...(statusCode !== undefined ? { statusCode } : {})
  }
}

/** HTTP status from prose such as `Request rejected (429)` or `API Error: 429 ...`. */
function statusFromProse(text: string): number | undefined {
  const match = /\b([45]\d\d)\b/.exec(text.slice(0, text.indexOf('data:')))
  if (match) return Number(match[1])
  return undefined
}
