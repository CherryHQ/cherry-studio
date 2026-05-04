import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ModelMessage } from 'ai'

/**
 * Per-request context. Constructed once per `streamText` / `generateText`
 * invocation in `AiService.buildAgentParams` and threaded through AI SDK's
 * `experimental_context` so every tool execute() handler receives the same
 * instance for the duration of the request.
 */
export interface RequestContext {
  /** Stable id correlating the whole request — used as telemetry trace key. */
  readonly requestId: string

  /** Topic / chat id when the call originates from a chat. Absent for
   *  synthetic / IPC-driven invocations. */
  readonly topicId?: string

  /** The assistant making the call. Tools that need static config — e.g.
   *  `kb__search` reading `assistant.knowledgeBaseIds` — pull from here. */
  readonly assistant?: Assistant

  /** Active provider — used by tools that branch on provider capability
   *  (e.g. `fs__read` deciding whether the model accepts native PDF). */
  readonly provider?: Provider

  /** Active model — used by tools that branch on model capability
   *  (e.g. `fs__read` deciding whether to emit `image-data` or extract text). */
  readonly model?: Model

  /**
   * Whole-request abort signal — present for cancellable paths
   */
  readonly abortSignal?: AbortSignal
}

/**
 * Combined per-call context handed to a tool handler. Composes the
 * per-request {@link RequestContext} with the per-call fields AI SDK
 * provides on every `execute()` invocation (toolCallId, current messages).
 */
export interface ToolCallContext {
  readonly request: RequestContext
  /** AI SDK-assigned id, unique per tool invocation. */
  readonly toolCallId: string
  /** Messages snapshot sent to the model that produced this tool call. */
  readonly messages: ModelMessage[]
}

/**
 * Unwrap the active context inside a tool's `execute(args, options)`. Throws
 * with a wiring-pointing message when called from a path that didn't attach
 * a RequestContext — typically a misconfigured `experimental_context` in
 * `AiService.buildAgentParams` or a test that forgot to mock it.
 *
 *     execute: async (args, options) => {
 *       const { request, toolCallId } = getToolCallContext(options)
 *       return doWork(args, { signal: request.abortSignal })
 *     }
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
