/**
 * OpenRouter `reasoning_details` shapes.
 *
 * Only the `ReasoningDetailUnion` type is consumed (by the reasoning cache). The
 * cached values are round-tripped opaquely — written from provider metadata and
 * replayed via `JSON.parse(JSON.stringify(...))` — so there is no runtime zod
 * validation; this file is the type contract only.
 *
 * @see https://openrouter.ai/docs/use-cases/reasoning-tokens
 */

export type ReasoningFormat =
  | 'unknown'
  | 'openai-responses-v1'
  | 'xai-responses-v1'
  | 'anthropic-claude-v1'
  | 'google-gemini-v1'

interface CommonReasoningDetail {
  id?: string | null
  format?: ReasoningFormat | null
  index?: number
  // The original schema was `.loose()`: provider-specific extra keys are allowed.
  [key: string]: unknown
}

export interface ReasoningDetailSummary extends CommonReasoningDetail {
  type: 'reasoning.summary'
  summary: string
}

export interface ReasoningDetailEncrypted extends CommonReasoningDetail {
  type: 'reasoning.encrypted'
  data: string
}

export interface ReasoningDetailText extends CommonReasoningDetail {
  type: 'reasoning.text'
  text?: string | null
  signature?: string | null
}

export type ReasoningDetailUnion = ReasoningDetailSummary | ReasoningDetailEncrypted | ReasoningDetailText
