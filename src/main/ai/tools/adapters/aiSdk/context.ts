import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import type { Assistant } from '@shared/data/types/assistant'
import type { ModelMessage } from 'ai'

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
