import type {
  ToolExecutionStartEvent as SdkToolExecutionStartEvent,
  ToolExecutionEndEvent as SdkToolExecutionEndEvent
} from 'ai'

import { loggerService } from '@logger'
import { chatErrorContext } from '@main/ai/utils/chatErrorContext'
import { redactToShape } from '@main/ai/utils/redactToShape'
import { isAbortError } from '@main/utils/error'

import type { AgentLoopHooks, ToolExecutionStartEvent } from './types'

export const logger = loggerService.withContext('agentLoop')

/** Swallows throws with a warn log. Returns `undefined` if missing or threw. */
export async function safeCall<F extends (...args: never[]) => unknown>(
  name: string,
  cb: F | undefined,
  ...args: Parameters<F>
): Promise<Awaited<ReturnType<F>> | undefined> {
  if (!cb) return undefined
  try {
    return (await cb(...args)) as Awaited<ReturnType<F>>
  } catch (err) {
    logger.warn(`hook ${name} threw`, err as Error)
    return undefined
  }
}

/** Isolates a hook forwarded to AI SDK. `undefined` if no source hook. */
export function wrapForwardedHook<F extends (...args: never[]) => unknown>(
  name: string,
  fn: F | undefined
): F | undefined {
  if (!fn) return undefined
  return ((...args: Parameters<F>) => safeCall(name, fn, ...args)) as F
}

/** Adapt native SDK events to Cherry's stable observer contract. */
export function createToolExecutionHooks(hooks: AgentLoopHooks) {
  const startEvent = (event: SdkToolExecutionStartEvent): ToolExecutionStartEvent => ({
    callId: event.toolCall.toolCallId,
    toolName: event.toolCall.toolName,
    input: event.toolCall.input,
    messages: event.messages
  })
  return {
    onToolExecutionStart: async (event: SdkToolExecutionStartEvent) => {
      await safeCall('onToolExecutionStart', hooks.onToolExecutionStart, startEvent(event))
    },
    onToolExecutionEnd: async (event: SdkToolExecutionEndEvent) => {
      const { toolOutput } = event
      if (toolOutput.type === 'tool-error' && !isAbortError(toolOutput.error)) {
        logger.warn('Tool execution failed', {
          toolName: event.toolCall.toolName,
          toolCallId: event.toolCall.toolCallId,
          durationMs: Math.round(event.toolExecutionMs),
          inputShape: redactToShape(event.toolCall.input),
          err: chatErrorContext(toolOutput.error)
        })
      }
      await safeCall('onToolExecutionEnd', hooks.onToolExecutionEnd, {
        ...startEvent(event),
        durationMs: event.toolExecutionMs,
        toolOutput
      })
    }
  }
}
