/**
 * @cherrystudio/protocol-translator
 *
 * Protocol Translation Layer: OpenAI ↔ Anthropic ↔ Gemini format conversion.
 *
 * ## Architecture
 *
 * The translation layer sits between the API Gateway's adapter system and
 * the upstream AI providers, converting request/response formats transparently.
 *
 * ```
 * Agent (Anthropic SDK)
 *   │ POST /v1/messages
 *   ▼
 * API Gateway (proxyStream)
 *   │ AnthropicMessageConverter → AI SDK UIMessages
 *   │ AiStreamManager → routes to correct AI SDK provider
 *   │
 *   ├─ Model has Anthropic endpoint? → direct passthrough
 *   └─ Model has OpenAI/Gemini endpoint? → translate via this package
 *        │ anthropicToOpenAI() / anthropicToGemini()
 *        │ Send to upstream
 *        │ openAIChoiceToContent() / OpenAIDeltaToAnthropicSSE
 *        │ Format as Anthropic SSE
 *        ▼
 *   AiSdkToAnthropicSse adapters → Anthropic SSE response
 * ```
 *
 * ## Usage
 *
 * ```ts
 * import {
 *   anthropicToOpenAI,
 *   openAIChoiceToContent,
 *   OpenAIDeltaToAnthropicSSE
 * } from '@cherrystudio/protocol-translator'
 * ```
 */

// Types
export type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicMessageParams,
  AnthropicTool,
  AnthropicToolUseBlock,
  OpenAIChatParams,
  OpenAIContentPart,
  OpenAIMessage,
  OpenAITool,
  GeminiContent,
  GeminiGenerateParams,
  GeminiPart,
  GeminiTool,
  TranslationContext
} from './types'

// Anthropic → OpenAI
export {
  anthropicToOpenAI,
  convertTools,
  convertAnthropicToolToOpenAI,
  splitToolResultMessages
} from './anthropic-to-openai'

// OpenAI → Anthropic
export {
  openAIChoiceToContent,
  mapOpenAIStopReason,
  OpenAIDeltaToAnthropicSSE
} from './openai-to-anthropic'
export type {
  AnthropicResponse,
  AnthropicSSEEvent
} from './openai-to-anthropic'

// Anthropic ↔ Gemini
export {
  anthropicToGemini,
  geminiContentToAnthropicBlocks,
  geminiToolsToAnthropic
} from './gemini-converter'
