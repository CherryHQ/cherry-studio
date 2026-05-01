/**
 * Internal request features — one bundle per concern. Order matters because
 * AI SDK plugin order is significant (e.g. `reasoning-extraction` must run
 * before `simulate-streaming`; `pdf-compatibility` must run before
 * `anthropic-cache`). Mirrors the prior `PluginBuilder.buildPlugins`
 * decision tree, now expressed as `RequestFeature.applies` gates.
 */

import type { RequestFeature } from '../feature'
import { anthropicCacheFeature } from './anthropicCache'
import { anthropicHeadersFeature } from './anthropicHeaders'
import { modelParamsFeature } from './modelParams'
import { noThinkFeature } from './noThink'
import { openrouterReasoningFeature } from './openrouterReasoning'
import { pdfCompatibilityFeature } from './pdfCompatibility'
import { promptToolUseFeature } from './promptToolUse'
import { providerUrlContextFeature } from './providerUrlContext'
import { providerWebSearchFeature } from './providerWebSearch'
import { qwenThinkingFeature } from './qwenThinking'
import { reasoningExtractionFeature } from './reasoningExtraction'
import { simulateStreamingFeature } from './simulateStreaming'
import { skipGeminiThoughtSignatureFeature } from './skipGeminiThoughtSignature'

export const INTERNAL_FEATURES: readonly RequestFeature[] = [
  modelParamsFeature,
  pdfCompatibilityFeature,
  reasoningExtractionFeature,
  simulateStreamingFeature,
  anthropicCacheFeature,
  anthropicHeadersFeature,
  openrouterReasoningFeature,
  noThinkFeature,
  qwenThinkingFeature,
  skipGeminiThoughtSignatureFeature,
  providerWebSearchFeature,
  providerUrlContextFeature,
  promptToolUseFeature
]
