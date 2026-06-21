/**
 * Internal request features — one bundle per concern. Order matters because
 * AI SDK plugin order is significant (e.g. `reasoning-extraction` must run
 * before `simulate-streaming`). Mirrors the prior `PluginBuilder.buildPlugins`
 * decision tree, now expressed as `RequestFeature.applies` gates.
 *
 * Attachments (pdf/office/image/audio/video) are read on demand through the
 * agentic `read_file` tool (`tools/fileLookup.ts` + `messages/attachmentManifest.ts`),
 * so there is no document-conversion middleware here.
 */

import type { RequestFeature } from '../feature'
import { anthropicCacheFeature } from './anthropicCache'
import { anthropicHeadersFeature } from './anthropicHeaders'
import { deepseekDsmlParserFeature } from './deepseekDsmlParserPlugin'
import { devtoolsFeature } from './devtools'
import { gatewayUsageNormalizeFeature } from './gatewayUsageNormalize'
import { modelParamsFeature } from './modelParams'
import { noThinkFeature } from './noThink'
import { openrouterReasoningFeature } from './openrouterReasoning'
import { providerUrlContextFeature } from './providerUrlContext'
import { providerWebSearchFeature } from './providerWebSearch'
import { qwenThinkingFeature } from './qwenThinking'
import { reasoningExtractionFeature } from './reasoningExtraction'
import { simulateStreamingFeature } from './simulateStreaming'
import { skipGeminiThoughtSignatureFeature } from './skipGeminiThoughtSignature'
import { steerYieldFeature } from './steerYield'

export const INTERNAL_FEATURES: readonly RequestFeature[] = [
  devtoolsFeature,
  gatewayUsageNormalizeFeature,
  modelParamsFeature,
  // DeepSeek-only: re-extract DSML-markup tool calls from text before reasoning extraction.
  deepseekDsmlParserFeature,
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
  // Stop condition only (no plugins/hooks) — yields a chat turn when a steer is queued.
  steerYieldFeature
]
