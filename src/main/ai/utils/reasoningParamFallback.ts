import { loggerService } from '@logger'

const logger = loggerService.withContext('aiCore.utils.reasoningParamFallback')

/**
 * Graceful fallback for OpenAI-compatible endpoints that reject reasoning
 * parameters (#24593).
 *
 * Cherry Studio sends `reasoning_effort` (chat-completions format) or
 * `reasoning` (responses format) whenever the resolved reasoning invocation
 * calls for it, but some custom OpenAI-compatible gateways do not implement
 * those fields and answer the whole turn with `400 Invalid reasoning_effort`.
 * When that happens the request body is known, the rejection names the
 * parameter, and the turn has already failed — so the wrapper retries the
 * same request exactly once with the reasoning fields removed and lets the
 * endpoint answer without them.
 *
 * Safety properties:
 *   - Only fires on HTTP 400 classified as blaming a reasoning parameter AND
 *     a request body that actually carries one; every other response is
 *     returned untouched, preserving the original error text for the
 *     diagnosis layer.
 *   - Retries at most once: if the stripped request is rejected too, that
 *     second response is returned as-is.
 *   - Non-400 responses return before the request body is parsed, so the
 *     success path pays no parse/serialize cost.
 *   - Non-JSON or non-string bodies (model listing GETs, multipart uploads)
 *     are never inspected or rewritten.
 *   - The fallback warning never logs the request URL: custom gateways can
 *     carry tenant tokens in the path or query, and string metadata persists.
 */

/** Request-body fields stripped on fallback: chat format and responses format. */
const REASONING_BODY_KEYS = ['reasoning_effort', 'reasoning'] as const

/** Structured error fields naming the rejected parameter (OpenAI-style envelopes). */
const STRUCTURED_PARAM_PATTERN = /^reasoning(?:_effort)?(?:\.[A-Za-z_]\w*|\[\d+\])*$/

/** Keep model-subject diagnostics intact even when a model's name equals a field. */
const MODEL_SUBJECT_PATTERN =
  /\bmodel(?:\s+(?:with\s+)?(?:id|name))?\s*(?:=\s*)?["'`]?reasoning(?:_effort)?["'`]?(?=\s|[.,:;]|$)/i

/** Message-only rejection must identify the complete field or its effort value. */
const MESSAGE_REJECTION_PATTERN =
  /(?:unrecognized|unknown|invalid|unsupported|unexpected|not supported|not permitted)\s+(?:(?:request\s+)?(?:argument|parameter|field)(?:\s+(?:supplied|named))?\s*:?\s*)?["'`]?reasoning(?:_effort|\.effort)?["'`]?(?=\s|[.,:;]|$)|(?:^|[\s"'`])reasoning(?:_effort|\.effort)?["'`]?\s+(?:value\s+["'`][^"'`\r\n]+["'`]\s+)?(?:is\s+)?(?:unrecognized|unknown|invalid|unsupported|unexpected|not supported|not permitted)\b|(?:^|[\s"'`])reasoning(?:_effort|\.effort)?["'`]?\s+does not support\s+["'`][^"'`\r\n]+["'`]/i

function isReasoningMessage(message: string): boolean {
  return !MODEL_SUBJECT_PATTERN.test(message) && MESSAGE_REJECTION_PATTERN.test(message)
}

/**
 * Classifies a 400 body as rejecting a reasoning parameter. Structured
 * envelopes win: when the provider names the rejected parameter (`error.param`
 * / `error.parameter`), only a path rooted at a reasoning field qualifies, so a
 * 400 blaming `model` is preserved even when the model id itself contains the
 * word. Message-only envelopes qualify when rejection wording directly identifies
 * the complete field as its subject.
 */
function isReasoningRejection(errorText: string): boolean {
  let envelope: unknown
  try {
    envelope = JSON.parse(errorText)
  } catch {
    envelope = undefined
  }

  const detail =
    envelope && typeof envelope === 'object' ? ((envelope as Record<string, unknown>).error ?? envelope) : undefined

  if (detail && typeof detail === 'object') {
    const param = (detail as Record<string, unknown>).param ?? (detail as Record<string, unknown>).parameter
    if (typeof param === 'string') return STRUCTURED_PARAM_PATTERN.test(param)
    const message = (detail as Record<string, unknown>).message
    if (typeof message === 'string') {
      return isReasoningMessage(message)
    }
  }

  return isReasoningMessage(errorText)
}

/**
 * Reads the JSON request body and reports whether it carries a reasoning
 * field, returning the stripped serialization and the removed keys when it
 * does. Returns null when the body is absent, not a string, not JSON, or has
 * no reasoning field.
 */
function stripReasoningFields(body: BodyInit | null | undefined): { body: string; stripped: string[] } | null {
  if (typeof body !== 'string') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const record = parsed as Record<string, unknown>
  const present = REASONING_BODY_KEYS.filter((key) => key in record)
  if (present.length === 0) return null

  for (const key of present) delete record[key]
  return { body: JSON.stringify(record), stripped: present }
}

/**
 * Wraps a provider fetch with the one-shot reasoning-parameter fallback. The
 * wrapped fetch is otherwise identical: same input, same init, same response
 * object for every request that does not hit the fallback path.
 */
export function withReasoningParamFallback(baseFetch: FetchLike): FetchLike {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await baseFetch(input, init)
    if (response.status !== 400) return response

    const stripped = stripReasoningFields(init?.body)
    if (stripped === null) return response

    // Inspect a clone so an unrelated 400 keeps its body for the caller.
    let errorText: string
    try {
      errorText = await response.clone().text()
    } catch {
      return response
    }
    if (!isReasoningRejection(errorText)) return response

    logger.warn('Endpoint rejected reasoning parameters; retrying once without them', {
      status: response.status,
      strippedKeys: stripped.stripped
    })
    return baseFetch(input, { ...init, body: stripped.body })
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
