import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import type { Assistant } from '@shared/data/types/assistant'
import type { ModelMessage } from 'ai'

/**
 * What the target model/provider can do with a file the `read_file` tool hands
 * back, deciding native-media vs extracted-text per attachment. Resolved once
 * per request from (provider, model) — see `resolveFileToolCapabilities`.
 */
export interface FileToolCapabilities {
  /** Provider accepts media inside a tool result (OpenAI-Responses / Anthropic / Gemini). */
  readonly acceptsMediaInToolResult: boolean
  /** Model can natively understand images. */
  readonly isVision: boolean
  /** Model can natively understand audio. */
  readonly isAudio: boolean
  /** Model can natively understand video. */
  readonly isVideo: boolean
}

/**
 * One attachment the `read_file` tool may read this request. The model
 * references files by `filename` (from the manifest) — the internal
 * `fileEntryId` never reaches the model. Doubles as an allow-list: the tool
 * only resolves files attached to the current conversation.
 */
export interface FileAttachmentRef {
  readonly fileEntryId: string
  readonly filename: string
  readonly mediaType: string
}

/**
 * Per-request context constructed once in `buildAgentParams` and
 * threaded through AI SDK's `experimental_context`. Kept minimal — add
 * fields only when a tool actually needs them.
 */
export interface RequestContext {
  /** Stable id for the whole request — telemetry trace key. */
  readonly requestId: string

  /** Absent for synthetic / IPC-driven invocations. */
  readonly topicId?: string

  /** Source of static config like `assistant.knowledgeBaseIds`. */
  readonly assistant?: Assistant

  readonly abortSignal?: AbortSignal

  /** Capability gate for the `read_file` tool's file-vs-text decision. */
  readonly fileToolCaps?: FileToolCapabilities

  /** Attachments the `read_file` tool may read this request (filename → entry allow-list). */
  readonly fileAttachments?: ReadonlyArray<FileAttachmentRef>
}

/** Per-call context: {@link RequestContext} + AI SDK's per-`execute` fields. */
export interface ToolCallContext {
  readonly request: RequestContext
  readonly toolCallId: string
  readonly messages: ModelMessage[]
}

/**
 * Throws when `experimental_context` is missing — usually means
 * `buildAgentParams` didn't thread `RequestContext` through, or a test
 * forgot to mock it.
 */
export function getToolCallContext(options: ToolExecutionOptions): ToolCallContext {
  const request = options.experimental_context
  if (!isRequestContext(request)) {
    throw new Error(
      'Tool execute called without RequestContext. AiService.buildAgentParams must thread RequestContext through agentSettings.experimental_context.'
    )
  }
  return {
    request,
    toolCallId: options.toolCallId,
    messages: options.messages
  }
}

function isRequestContext(value: unknown): value is RequestContext {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<RequestContext>
  return typeof candidate.requestId === 'string'
}
