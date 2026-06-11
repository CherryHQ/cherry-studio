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
import { deepseekDsmlParserFeature } from './deepseekDsmlParserPlugin'
import { devtoolsFeature } from './devtools'
import { gatewayUsageNormalizeFeature } from './gatewayUsageNormalize'
import { modelParamsFeature } from './modelParams'
import { noThinkFeature } from './noThink'
import { openrouterReasoningFeature } from './openrouterReasoning'
import { pdfCompatibilityFeature } from './pdfCompatibility'
import { providerUrlContextFeature } from './providerUrlContext'
import { providerWebSearchFeature } from './providerWebSearch'
import { qwenThinkingFeature } from './qwenThinking'
import { reasoningExtractionFeature } from './reasoningExtraction'
import { simulateStreamingFeature } from './simulateStreaming'
import { skipGeminiThoughtSignatureFeature } from './skipGeminiThoughtSignature'

export const INTERNAL_FEATURES: readonly RequestFeature[] = [
  devtoolsFeature,
  gatewayUsageNormalizeFeature,
  modelParamsFeature,
  pdfCompatibilityFeature,
  // DeepSeek-only: re-extract DSML-markup tool calls from text before reasoning extraction.
  deepseekDsmlParserFeature,
  reasoningExtractionFeature,
  simulateStreamingFeature,
  // Must precede anthropic-cache: middleware array order = transformParams
  // order, and truncation has to rewrite tool results BEFORE cache markers
  // are placed on trailing messages (part-level providerOptions survive
  // chef's IR round-trip — pinned by contextBuild.test.ts).
  contextBuildFeature,
  anthropicCacheFeature,
  anthropicHeadersFeature,
  openrouterReasoningFeature,
  noThinkFeature,
  qwenThinkingFeature,
  skipGeminiThoughtSignatureFeature,
  providerWebSearchFeature,
  providerUrlContextFeature
]
