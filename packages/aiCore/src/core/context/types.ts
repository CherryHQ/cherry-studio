/**
 * Context 模块内部表示(IR)类型。
 *
 * Vendored from @context-chef/core 3.8.0 (MIT, same author) — trimmed to the
 * surface Cherry Studio consumes: the IR message shape shared by the
 * middleware pipeline, the compaction planners, and the summarizer.
 */

/**
 * Minimal logging hook for degradation warnings (storage write failures,
 * misconfiguration, swallowed callback errors). Defaults to `console`.
 * Pass your host's logger service to land warnings in application logs.
 */
export interface ContextLogger {
  warn(message: string, ...args: unknown[]): void
}

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // JSON string
  }
}

/**
 * Thinking content produced by a model during extended thinking mode.
 * The `signature` field is required by Anthropic when echoing thinking back in multi-turn.
 */
export interface ThinkingContent {
  thinking: string
  signature?: string
}

/**
 * Privacy-redacted thinking block (Anthropic-specific).
 * The opaque `data` blob must be echoed verbatim in multi-turn conversations.
 */
export interface RedactedThinking {
  data: string
}

/**
 * Media attachment on a message — images, files, audio, etc.
 * Provider-neutral IR representation.
 */
export interface Attachment {
  /** MIME type, e.g. 'image/png', 'application/pdf', 'audio/mp3' */
  mediaType: string
  /** base64 encoded data or URL string */
  data: string
  /** Optional filename */
  filename?: string
}

export interface ContextMessage {
  role: Role
  content: string
  name?: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  /**
   * Thinking/reasoning content produced by the model.
   */
  thinking?: ThinkingContent
  /**
   * Redacted thinking block (Anthropic extended thinking with privacy filter).
   * Must be echoed verbatim.
   */
  redacted_thinking?: RedactedThinking
  /**
   * Media attachments (images, files, etc.) on this message.
   * `content` always holds the text-only representation.
   * When present during compression, the summarizer prompt is augmented with
   * text placeholders instead of shipping binary payloads.
   */
  attachments?: Attachment[]
  /** Allow provider-specific or adapter pass-through fields without loss */
  [key: string]: unknown
}
