/**
 * `agent` tool — lets the parent LLM spawn a sub-agent dynamically.
 *
 * Sibling of `tools/agent/explore.ts` (a static profile factory). Lives
 * under `tools/agent/` rather than `tools/meta/` because `meta/` is
 * reserved for registry-reflection tools (`tool_search` / `tool_invoke` /
 * etc.) — the agent tool spawns a child runtime, it doesn't reflect on
 * the registry.
 *
 * Sync mode: yields the child's text deltas as preliminary tool results;
 * the final yield is the tool result the parent's LLM consumes.
 *
 * Async mode (`run_in_background: true`): returns a `taskId` immediately;
 * the child runs detached and the final text is injected back into the
 * parent's conversation as a synthetic user message via the `inject`
 * callback (per-execution by default — sub-agent results scope to the
 * spawning execution, not all parallel models in the topic).
 *
 * Both modes go through the same `spawnChild` primitive — same identity,
 * same abort plumbing, same registry membership. They differ only in
 * how the caller consumes the resulting `ChildHandle` (inline vs detached).
 *
 * Constructed per-request and inlined into the ToolSet by the agent-tool
 * exposition wirer. Not registered in the global registry.
 */

import { loggerService } from '@logger'
import type { Message } from '@shared/data/types/message'
import { type Tool, tool } from 'ai'
import * as z from 'zod'

import type { Agent } from '../../agent/Agent'
import { buildAsyncTaskErrorMessage, buildAsyncTaskResultMessage } from '../../messages/syntheticUserMessage'
import { AsyncChildAbortMap } from './AsyncChildAbortMap'

const logger = loggerService.withContext('agentTool')

/**
 * Tool name surfaced to the LLM. Single source of truth — referenced by
 * `tools/profile.ts` (capability classification) and
 * `tools/profiles/readOnly.ts` (block list).
 */
export const AGENT_TOOL_NAME = 'agent' as const

export interface AgentToolDeps {
  /** Per-call factory — fresh child for every invocation. */
  buildChild: () => Agent
  /**
   * Where async-mode results are delivered. Wired by the caller —
   * typically `(msg) => streamManager.injectMessage(topicId, msg)`.
   * Optional — when omitted (together with `topicId`), async mode is
   * disabled and `run_in_background: true` falls back to sync.
   */
  inject?: (message: Message) => boolean
  /** Parent topic id — written into synthetic-message `topicId` field. */
  topicId?: string
  /**
   * Per-stream abort map, shared across all calls produced by this factory.
   * Both sync and async children register here so `abortAll('parent-stream-end')`
   * cancels everything on parent termination. Optional — a stack-local map
   * is created when missing (sync still works; async loses cross-call abortAll).
   */
  asyncTasks?: AsyncChildAbortMap
}

const inputSchema = z.object({
  description: z.string().min(1).max(60).describe('Short (3-5 word) summary of the task. Used for UI labels.'),
  prompt: z.string().min(1).describe('Full task instructions for the sub-agent.'),
  run_in_background: z
    .boolean()
    .optional()
    .describe(
      'If true, return immediately with a taskId; the result will be delivered as a user message when the sub-agent completes. If false or omitted, wait for completion and return the final text.'
    )
})

interface ChildHandle {
  taskId: string
  consume(): AsyncGenerator<string, string>
}

export function createAgentTool(deps: AgentToolDeps): Tool {
  const asyncSupported = Boolean(deps.inject && deps.topicId)
  const abortMap = deps.asyncTasks ?? new AsyncChildAbortMap()

  return tool({
    description:
      'Delegate a task to a sub-agent. Use sync mode to get the result inline; pass `run_in_background: true` to detach so you can continue while it works — the result will arrive later as a user message.',
    inputSchema,
    // Both branches return string so AI SDK can unify OUTPUT.
    // Async-mode ack is JSON-serialized; the LLM parses it directly.
    execute: async function* (input, { abortSignal }) {
      const detached = Boolean(input.run_in_background && asyncSupported)
      const handle = spawnChild(deps.buildChild(), input.prompt, abortSignal, abortMap, { detached })

      if (detached) {
        void drainAndInject(handle, deps as Required<Pick<AgentToolDeps, 'inject' | 'topicId'>>)
        return JSON.stringify(buildAck(handle.taskId, input.description))
      }
      return yield* handle.consume()
    }
  }) as Tool
}

function spawnChild(
  child: Agent,
  prompt: string,
  parentSignal: AbortSignal | undefined,
  abortMap: AsyncChildAbortMap,
  opts: { detached: boolean }
): ChildHandle {
  const taskId = `agent-${shortId()}`
  const ac = new AbortController()
  if (!opts.detached) {
    parentSignal?.addEventListener('abort', () => ac.abort('parent-abort'), { once: true })
  }
  abortMap.set(taskId, ac)

  return {
    taskId,
    consume: async function* () {
      try {
        return yield* child.executeAsTool(prompt, ac.signal)
      } finally {
        abortMap.delete(taskId)
      }
    }
  }
}

interface AsyncAck {
  taskId: string
  status: 'started'
  description: string
  note: string
}

// TODO: use system reminder to remind the user that the task is running in the background.
function buildAck(taskId: string, description: string): AsyncAck {
  return {
    taskId,
    status: 'started',
    description,
    note: `Task ${taskId} is running in the background. The result will arrive as a user message tagged <async-task-result task="${taskId}"> when complete.`
  }
}

async function drainAndInject(
  handle: ChildHandle,
  deps: Required<Pick<AgentToolDeps, 'inject' | 'topicId'>>
): Promise<void> {
  let finalText = ''
  let errorText: string | undefined

  try {
    const gen = handle.consume()
    while (true) {
      const next = await gen.next()
      if (next.done) {
        finalText = next.value
        break
      }
      // Discard intermediate deltas — async mode reports once on completion.
    }
  } catch (err) {
    errorText = err instanceof Error ? err.message : String(err)
  }

  const message = errorText
    ? buildAsyncTaskErrorMessage(deps.topicId, handle.taskId, errorText)
    : buildAsyncTaskResultMessage(deps.topicId, handle.taskId, finalText)

  if (!deps.inject(message)) {
    logger.warn('async agent completed but parent stream is dead; result dropped', { taskId: handle.taskId })
  }
}

function shortId(): string {
  // 6 hex chars from a uuid is plenty for human-distinguishable task ids.
  return crypto.randomUUID().replace(/-/g, '').slice(0, 6)
}
