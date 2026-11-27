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
 *   - Only fires on HTTP 400 whose body mentions a reasoning parameter AND a
 *     request body that actually carries one; every other response (including
 *     400s about anything else) is returned untouched, preserving the
 *     original error text for the diagnosis layer.
 *   - Retries at most once: if the stripped request is rejected too, that
 *     second response is returned as-is.
 *   - Non-JSON or non-string bodies (model listing GETs, multipart uploads)
 *     are never inspected or rewritten.
 */

/** Request-body fields stripped on fallback: chat format and responses format. */
const REASONING_BODY_KEYS = ['reasoning_effort', 'reasoning'] as const

/**
 * Matches provider error payloads that blame a reasoning parameter, e.g.
 * `Invalid reasoning_effort`, `"reasoning" is not supported`, or
 * `unrecognized request argument: reasoning`. Kept narrow on purpose: a
 * coincidental match costs one extra round-trip that fails identically, but
 * we should not strip fields on an unrelated 400 (e.g. a bad model id whose
 * message happens to mention the word).
 */
const REASONING_REJECTION_PATTERN =
  /reasoning[_ ]?effort|"reasoning"|reasoning.{0,24}(not supported|unrecognized|unknown|invalid)/i

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * Reads the JSON request body and reports whether it carries a reasoning
 * field, returning the stripped serialization when it does. Returns null when
 * the body is absent, not a string, not JSON, or has no reasoning field.
 */
function stripReasoningFields(body: BodyInit | null | undefined): string | null {
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
  return JSON.stringify(record)
}

/**
 * Wraps a provider fetch with the one-shot reasoning-parameter fallback. The
 * wrapped fetch is otherwise identical: same input, same init, same response
 * object for every request that does not hit the fallback path.
 */
export function withReasoningParamFallback(baseFetch: FetchLike): FetchLike {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await baseFetch(input, init)

    const strippedBody = stripReasoningFields(init?.body)
    if (response.status !== 400 || strippedBody === null) return response

    // Inspect a clone so an unrelated 400 keeps its body for the caller.
    let errorText: string
    try {
      errorText = await response.clone().text()
    } catch {
      return response
    }
    if (!REASONING_REJECTION_PATTERN.test(errorText)) return response

    logger.warn('Endpoint rejected reasoning parameters; retrying once without them', {
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      status: response.status
    })
    return baseFetch(input, { ...init, body: strippedBody })
  }
}
