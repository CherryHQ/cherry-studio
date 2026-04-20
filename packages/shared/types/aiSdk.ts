/**
 * AI SDK request parameter types shared between main and renderer.
 *
 * Ported from `src/renderer/src/types/aiCoreTypes.ts` (renderer origin/main,
 * still live there — the code-freeze branch coexists until the v2 cutover).
 * Both processes need these types to talk about the same standard parameter
 * set, so they live in shared.
 */

import type OpenAI from '@cherrystudio/openai'
import * as z from 'zod'

type NotUndefined<T> = Exclude<T, undefined>

/**
 * Model response verbosity knob (OpenAI Responses API).
 *
 * The original type unifies `undefined` and `null`:
 *   - `undefined` → parameter is omitted from the request
 *   - `null` → verbosity is explicitly disabled
 */
export type OpenAIVerbosity = OpenAI.Responses.ResponseTextConfig['verbosity']
export type ValidOpenAIVerbosity = NotUndefined<OpenAIVerbosity>

/** Reasoning effort level accepted by OpenAI reasoning-capable models. */
export type OpenAIReasoningEffort = NonNullable<OpenAI.ReasoningEffort> | 'auto'

/**
 * Summary configuration for OpenAI reasoning responses.
 *   - `undefined` → parameter is omitted from the request
 *   - `null` → summary is explicitly disabled
 */
export type OpenAIReasoningSummary = OpenAI.Reasoning['summary']

/** Streaming-response options — only valid when `stream: true` is set. */
export type OpenAICompletionsStreamOptions = OpenAI.ChatCompletionStreamOptions

/**
 * AI SDK "standard" request parameters — the subset of sampler / generation
 * knobs that apply uniformly across providers. Everything else (reasoning
 * effort, thinking tokens, serviceTier, etc.) is provider-specific and lives
 * on `params.providerOptions[providerId]`.
 */
const AiSdkParamsSchema = z.enum([
  'maxOutputTokens',
  'temperature',
  'topP',
  'topK',
  'presencePenalty',
  'frequencyPenalty',
  'stopSequences',
  'seed'
])

export type AiSdkParam = z.infer<typeof AiSdkParamsSchema>

export const isAiSdkParam = (param: string): param is AiSdkParam => AiSdkParamsSchema.safeParse(param).success
