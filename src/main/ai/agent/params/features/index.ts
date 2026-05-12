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
import { contextBuildFeature } from './contextBuild'
import { devtoolsFeature } from './devtools'
import { gatewayUsageNormalizeFeature } from './gatewayUsageNormalize'
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
import { staticRemindersFeature } from './staticReminders'

export const INTERNAL_FEATURES: readonly RequestFeature[] = [
  devtoolsFeature,
  gatewayUsageNormalizeFeature,
  modelParamsFeature,
  pdfCompatibilityFeature,
  reasoningExtractionFeature,
  simulateStreamingFeature,
  // Reminder injection runs before any provider-specific message
  // adapter (anthropic-cache, etc.) so the wrapped block becomes part
  // of the prompt those features see and price for.
  staticRemindersFeature,
  // context-build runs BEFORE anthropic-cache so cache markers are placed
  // on the post-truncation/compaction shape. The chef-backed middleware
  // preserves message-level `providerOptions` losslessly through round-trip,
  // so anthropic markers pass through subsequent middleware unharmed.
  contextBuildFeature,
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
