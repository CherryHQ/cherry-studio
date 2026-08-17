/**
 * Reasoning-model request-body conversion for `@ai-sdk/openai-compatible`.
 *
 * OpenAI reasoning models (o1, o3, o4-mini, GPT-5) reject `max_tokens` and
 * require `max_completion_tokens` instead. The compatible SDK always sends
 * `max_tokens`, so this `transformRequestBody` hook rewrites the field for
 * matching models.
 */

/**
 * Detect OpenAI reasoning models that require `max_completion_tokens` instead of
 * `max_tokens`. Matches the pattern used internally by `@ai-sdk/openai`.
 */
export function isOpenAIReasoningModelId(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return (
    id.startsWith('o1') ||
    id.startsWith('o3') ||
    id.startsWith('o4-mini') ||
    (id.startsWith('gpt-5') && !id.startsWith('gpt-5-chat'))
  )
}

/**
 * `transformRequestBody` hook for `@ai-sdk/openai-compatible`: rewrites
 * `max_tokens` → `max_completion_tokens` for OpenAI reasoning models.
 */
export function applyReasoningModelMaxTokensConversion(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body
  const record = body as Record<string, unknown>
  if (typeof record.model !== 'string') return body
  if (!isOpenAIReasoningModelId(record.model)) return body
  if (record.max_tokens == null) return body
  const { max_tokens, ...rest } = record
  return { ...rest, max_completion_tokens: max_tokens }
}
