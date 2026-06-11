/**
 * Shared types for protocol translation between AI API formats.
 *
 * Covers three major formats:
 * - Anthropic Messages API (Claude)
 * - OpenAI Chat Completions API (GPT)
 * - Google Gemini GenerateContent API
 */

// ── Message Roles ──────────────────────────────────────────────────────────

export type AnthropicRole = 'user' | 'assistant'
export type OpenAIRole = 'system' | 'user' | 'assistant' | 'tool' | 'developer'
export type GeminiRole = 'user' | 'model'

// ── Content Block Types ────────────────────────────────────────────────────

/** Anthropic content block */
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicThinkingBlock
  | AnthropicImageBlock

export interface AnthropicTextBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' } | null
}

export interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | AnthropicContentBlock[]
  is_error?: boolean
}

export interface AnthropicThinkingBlock {
  type: 'thinking'
  thinking: string
  signature: string
}

export interface AnthropicImageBlock {
  type: 'image'
  source: {
    type: 'base64' | 'url'
    media_type: string
    data?: string
    url?: string
  }
}

/** Anthropic tool definition */
export interface AnthropicTool {
  name: string
  description?: string
  input_schema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
  }
  cache_control?: { type: 'ephemeral' } | null
}

/** Anthropic Messages API request params */
export interface AnthropicMessageParams {
  model: string
  messages: AnthropicMessage[]
  system?: string | AnthropicTextBlock[]
  max_tokens: number
  temperature?: number
  top_p?: number
  top_k?: number
  stop_sequences?: string[]
  stream?: boolean
  tools?: AnthropicTool[]
  thinking?: {
    type: 'enabled' | 'disabled'
    budget_tokens?: number
  }
}

export interface AnthropicMessage {
  role: AnthropicRole
  content: string | AnthropicContentBlock[]
}

// ── OpenAI Types ───────────────────────────────────────────────────────────

/** OpenAI message content part */
export type OpenAIContentPart =
  | OpenAITextContent
  | OpenAIImageContent
  | OpenAIToolCallContent
  | OpenAIRefusalContent

export interface OpenAITextContent {
  type: 'text'
  text: string
}

export interface OpenAIImageContent {
  type: 'image_url'
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' }
}

export interface OpenAIToolCallContent {
  type: 'function'
  function: {
    name: string
    arguments: string // JSON string
  }
}

export interface OpenAIRefusalContent {
  type: 'refusal'
  refusal: string
}

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // JSON string
  }
}

/** OpenAI message */
export interface OpenAIMessage {
  role: OpenAIRole
  content: string | OpenAIContentPart[] | null
  name?: string
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
  refusal?: string | null
}

/** OpenAI tool definition (function calling) */
export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
    strict?: boolean
  }
}

/** OpenAI Chat Completions request params */
export interface OpenAIChatParams {
  model: string
  messages: OpenAIMessage[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string | string[]
  stream?: boolean
  tools?: OpenAITool[]
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } }
  reasoning_effort?: 'low' | 'medium' | 'high'
}

// ── Gemini Types ───────────────────────────────────────────────────────────

/** Gemini content part */
export type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiFileDataPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart

export interface GeminiTextPart {
  text: string
}

export interface GeminiInlineDataPart {
  inlineData: {
    mimeType: string
    data: string // base64
  }
}

export interface GeminiFileDataPart {
  fileData: {
    mimeType: string
    fileUri: string
  }
}

export interface GeminiFunctionCallPart {
  functionCall: {
    name: string
    args: Record<string, unknown>
  }
}

export interface GeminiFunctionResponsePart {
  functionResponse: {
    name: string
    response: Record<string, unknown>
  }
}

/** Gemini content (one turn) */
export interface GeminiContent {
  role: GeminiRole
  parts: GeminiPart[]
}

/** Gemini function declaration */
export interface GeminiFunctionDeclaration {
  name: string
  description?: string
  parameters?: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
  }
}

/** Gemini tool config */
export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[]
}

/** Gemini GenerateContent request params */
export interface GeminiGenerateParams {
  model: string
  contents: GeminiContent[]
  systemInstruction?: GeminiPart
  generationConfig?: {
    maxOutputTokens?: number
    temperature?: number
    topP?: number
    topK?: number
    stopSequences?: string[]
  }
  tools?: GeminiTool[]
  safetySettings?: unknown[]
}

// ── Translation Context ────────────────────────────────────────────────────

/** Metadata preserved across translation */
export interface TranslationContext {
  /** Original format */
  sourceFormat: 'anthropic' | 'openai' | 'gemini'
  /** Target format */
  targetFormat: 'anthropic' | 'openai' | 'gemini'
  /** Map of Anthropic tool_use IDs to function call names */
  toolUseMap: Map<string, string>
  /** Map of OpenAI tool_call IDs to tool names */
  openaiToolCallMap: Map<string, string>
  /** Whether the request is streaming */
  streaming: boolean
}
