/**
 * Body-level compatibility rewrite for OpenAI-compatible endpoints.
 *
 * `@ai-sdk/openai-compatible` always serializes the AI SDK's `maxOutputTokens`
 * as legacy `max_tokens` on the wire. That is correct for most compatible
 * servers, but OpenAI reasoning families (GPT-5.x, o1, o3, o4) REJECT
 * `max_tokens` outright (`400 Unsupported parameter … Use
 * 'max_completion_tokens' instead`). Requests that cannot avoid declaring an
 * output budget then fail hard — most visibly Agent-mode runs, where the local
 * Anthropic-protocol gateway must translate the Anthropic-required `max_tokens`
 * into stream options, but also ordinary chat requests that set a token limit.
 *
 * The provider package offers no hook to influence the wire parameter name, so
 * the fix lives at the fetch boundary: a thin wrapper around the caller's
 * (possibly proxy-aware) customFetch that renames `max_tokens` →
 * `max_completion_tokens` on matching bodies. Everything else passes through
 * byte-for-byte, and the cheap substring pre-check keeps non-matching traffic
 * free of any JSON parsing.
 */

/**
 * Model ids whose OpenAI-shaped chat API rejects legacy `max_tokens`.
 * Matches GPT-5.x (`gpt-5`, `gpt-5-mini`, date-suffixed variants), the
 * o-series (`o1`, `o3-mini`, `o4-mini`, …) and vendor-prefixed ids
 * (`openai/gpt-5`). Deliberately narrow — this targets OpenAI's own naming;
 * unrelated ids like `gpt-4o`, `gpt-50` or `omni-*` do not match.
 */
export const MAX_COMPLETION_TOKENS_MODEL_PATTERN = /(?:^|\/)(?:gpt-5|o[134])(?:[-._]|$)/

export function isMaxCompletionTokensModel(modelId: unknown): boolean {
  return typeof modelId === 'string' && MAX_COMPLETION_TOKENS_MODEL_PATTERN.test(modelId)
}

/**
 * Rewrite a serialized chat-completions request body: for models that reject
 * legacy `max_tokens`, move the value to `max_completion_tokens`. Any input
 * that does not need rewriting is returned unchanged (same string).
 */
export function rewriteMaxTokensToMaxCompletionTokens(requestBody: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(requestBody)
  } catch {
    return requestBody
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return requestBody
  }
  const body = parsed as Record<string, unknown>
  // Only touch bodies that carry the legacy param; never clobber an explicit
  // `max_completion_tokens` if one was somehow already present.
  if (!isMaxCompletionTokensModel(body.model)) return requestBody
  if (typeof body.max_tokens !== 'number' || body.max_completion_tokens != null) return requestBody
  const { max_tokens, ...rest } = body
  return JSON.stringify({ ...rest, max_completion_tokens: max_tokens })
}

/**
 * Wrap a fetch implementation so OpenAI-compatible chat bodies carrying
 * `max_tokens` for reasoning-family models are rewritten before hitting the
 * wire (see module docs). Non-matching requests reach `baseFetch` untouched.
 */
export function withReasoningModelBodyRewrite(baseFetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    // The AI SDK invokes fetch as `(url, { body: jsonString })`; a Request-object
    // invocation carries its body elsewhere and is passed through as-is.
    const body = typeof init?.body === 'string' ? init.body : undefined
    if (!body || !body.includes('"max_tokens"')) {
      return baseFetch(input, init)
    }
    const rewritten = rewriteMaxTokensToMaxCompletionTokens(body)
    if (rewritten === body) {
      return baseFetch(input, init)
    }
    return baseFetch(input, { ...init, body: rewritten })
  }
}
