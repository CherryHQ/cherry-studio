/**
 * Internal helpers for the agent loop.
 *
 * Extracted from `loop/index.ts` so the `Agent` class (`../Agent.ts`) can
 * share them without forcing a circular import via the wrapper.
 */

import { loggerService } from '@logger'
import type { ToolSet } from 'ai'

import type { AgentLoopHooks, ToolExecutionStartEvent } from './index'

export const logger = loggerService.withContext('agentLoop')

/**
 * Mirrors AI SDK v7's `notify` shape: await the callback so hook ordering
 * stays deterministic, but never let a thrown hook abort the tool call. v7
 * silently swallows; we log at warn level since we already have a contextual
 * logger.
 */
export async function notifyHook<E>(cb: ((event: E) => Promise<void> | void) | undefined, event: E): Promise<void> {
  if (!cb) return
  try {
    await cb(event)
  } catch (err) {
    logger.warn('tool-execution hook threw', err as Error)
  }
}

export async function callHook<R>(name: string, fn: () => Promise<R> | R): Promise<R | undefined> {
  try {
    return await fn()
  } catch (err) {
    logger.warn(`hook ${name} threw; ignoring return value`, err as Error)
    return undefined
  }
}

/**
 * Wrap a user-supplied hook so it stays isolated when forwarded to a
 * third party (e.g. the AI SDK calls `prepareStep` / `onStepFinish` from
 * inside its execution loop). Returns `undefined` if the source hook is
 * absent so we don't pay for an empty wrapper.
 */
export function wrapForwardedHook<F extends (...args: never[]) => unknown>(
  name: string,
  fn: F | undefined
): F | undefined {
  if (!fn) return undefined
  return ((...args: Parameters<F>) => callHook(name, () => fn(...args))) as F
}

/**
 * Wrap each tool's `execute` so `onToolExecutionStart` / `onToolExecutionEnd`
 * fire around the call. The wrapper measures `durationMs` from immediately
 * after the start hook resolves to immediately before the end hook is
 * dispatched, matching v7's `executeToolCall` (excludes hook latency from the
 * tool's measured duration). Errors propagate after the end hook runs so the
 * SDK still treats tool failures normally.
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
        await notifyHook(hooks.onToolExecutionStart, startEvent)

        const startTime = performance.now()
        try {
          // NOTE: AI SDK v6 allows `execute` to return AsyncIterable for
          // preliminary streaming results. None of this codebase's tools
          // use that today; if one ever does, the iterable would be
          // returned untouched but the end hook would fire prematurely.
          // Update the wrapper at that point — see v7's `for await` loop
          // in `execute-tool-call.ts` for the reference implementation.
          const output = await originalExecute(input, options)
          const durationMs = performance.now() - startTime
          await notifyHook(hooks.onToolExecutionEnd, {
            ...startEvent,
            durationMs,
            toolOutput: { type: 'tool-result', output }
          })
          return output
        } catch (error) {
          const durationMs = performance.now() - startTime
          await notifyHook(hooks.onToolExecutionEnd, {
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
