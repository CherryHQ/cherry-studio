import { loggerService } from '@logger'
import type { ToolSet } from 'ai'

import type { AgentLoopHooks, ToolExecutionStartEvent } from './index'

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

/**
 * Brackets each tool's `execute` with start/end hooks. `durationMs`
 * excludes hook latency, matching v7's `executeToolCall`. Errors
 * propagate after the end hook runs.
 */
export function wrapToolsWithExecutionHooks(tools: ToolSet | undefined, hooks: AgentLoopHooks): ToolSet | undefined {
  if (!tools) return tools
  if (!hooks.onToolExecutionStart && !hooks.onToolExecutionEnd) return tools

  const wrapped: ToolSet = {}
  for (const [name, tool] of Object.entries(tools)) {
    const originalExecute = tool.execute
    if (typeof originalExecute !== 'function') {
      wrapped[name] = tool
      continue
    }
    wrapped[name] = {
      ...tool,
      execute: async (input: unknown, options) => {
        const startEvent: ToolExecutionStartEvent = {
          callId: options.toolCallId,
          toolName: name,
          input,
          messages: options.messages
        }
        await safeCall('onToolExecutionStart', hooks.onToolExecutionStart, startEvent)

        const startTime = performance.now()
        try {
          // NB: AI SDK v6 allows `execute` to return AsyncIterable for preliminary results.
          // No current tool uses that; the end hook would fire prematurely if one did.
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
          await safeCall('onToolExecutionEnd', hooks.onToolExecutionEnd, {
            ...startEvent,
            durationMs,
            toolOutput: { type: 'tool-error', error }
          })
          throw error
        }
      }
    } as ToolSet[string]
  }
  return wrapped
}
