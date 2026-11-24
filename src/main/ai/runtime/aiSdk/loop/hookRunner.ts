import type { ToolExecutionOptions, ToolSet } from 'ai'

import { loggerService } from '@logger'
import { chatErrorContext } from '@main/ai/utils/chatErrorContext'
import { redactToShape } from '@main/ai/utils/redactToShape'

import type { AgentLoopHooks, ToolExecutionStartEvent } from './types'

export const logger = loggerService.withContext('agentLoop')

/** Swallows throws with a warn log. Returns `undefined` if missing or threw. */
export async function safeCall<TArgs extends unknown[], TResult>(
  name: string,
  cb: ((...args: TArgs) => TResult) | undefined,
  ...args: TArgs
): Promise<Awaited<TResult> | undefined> {
  if (!cb) return undefined

  try {
    return await cb(...args)
  } catch (err) {
    logger.warn(`hook ${name} threw`, err)

    return undefined
  }
}

/** Isolates a hook forwarded to AI SDK. `undefined` if no source hook. */
export function wrapForwardedHook<TArgs extends unknown[], TResult>(
  name: string,
  fn: ((...args: TArgs) => TResult) | undefined
): ((...args: TArgs) => Promise<Awaited<TResult> | undefined>) | undefined {
  if (!fn) return undefined

  return (...args) => safeCall(name, fn, ...args)
}

/**
 * Brackets each tool's `execute` with start/end hooks. `durationMs`
 * excludes hook latency. Errors
 * propagate after the end hook runs.
 */
export function wrapToolsWithExecutionHooks(tools: ToolSet | undefined, hooks: AgentLoopHooks): ToolSet | undefined {
  if (!tools) return tools

  const wrapped: ToolSet = {}

  for (const [name, tool] of Object.entries(tools)) {
    const originalExecute = tool.execute

    if (typeof originalExecute !== 'function') {
      wrapped[name] = tool
      continue
    }

    wrapped[name] = {
      ...tool,
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- ToolSet erases each tool's input type; the SDK owns schema parsing and this wrapper forwards the input unchanged.
      execute: async (input: unknown, options: ToolExecutionOptions) => {
        const startEvent: ToolExecutionStartEvent = {
          callId: options.toolCallId,
          toolName: name,
          input,
          messages: options.messages
        }

        await safeCall('onToolExecutionStart', hooks.onToolExecutionStart, startEvent)

        const startTime = performance.now()

        try {
          // Current tools return ordinary results; this async wrapper cannot preserve AsyncIterable execution.
          const output = await originalExecute(input, options)
          const durationMs = performance.now() - startTime
          await safeCall('onToolExecutionEnd', hooks.onToolExecutionEnd, {
            ...startEvent,
            durationMs,
            toolOutput: { type: 'tool-result', output }
          })

          return output
        } catch (error) {
          const durationMs = performance.now() - startTime

          // Without this, a failed tool call survives only as the `tool-error` part's text in
          // the chat record — a bundle source that is opt-in and off by default.
          if (!options.abortSignal?.aborted) {
            logger.warn('Tool execution failed', {
              toolName: name,
              toolCallId: options.toolCallId,
              durationMs: Math.round(durationMs),
              inputShape: redactToShape(input),
              err: chatErrorContext(error)
            })
          }

          await safeCall('onToolExecutionEnd', hooks.onToolExecutionEnd, {
            ...startEvent,
            durationMs,
            toolOutput: { type: 'tool-error', error }
          })
          throw error
        }
      }
    }
  }

  return wrapped
}
