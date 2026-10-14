import type { AssistantMessage, Usage } from '@earendil-works/pi-ai'
import type { ToolCallPart } from 'ai'

import type { AgentRuntimeSession } from './session'
import type { Subagent, SubagentSessionOptions } from './subagent'
import type { TranscriptEntry, TranscriptMessageEntry, TranscriptStateEntry } from './transcript'
import type { AgentRuntimeEvent } from './transcriptTap'

/** Model requests one run may make before it is stopped (Claude Code's limit for a fork). */
export const MAX_SUBAGENT_REQUESTS = 200

/** State entry naming the call that created a session; it marks a subagent's session. */
export const SUBAGENT_ORIGIN_STATE = 'cherry.subagent-origin'

/** How one run of a subagent session ended, as the session itself saw it. */
export type RunEnd = 'completed' | 'failed' | 'truncated' | 'aborted' | 'limit_reached'

export interface RunResult {
  end: RunEnd
  /** The final message, trimmed; set when the run completed. */
  report?: string
  /** The error that ended the run. */
  reason?: string
  /** The last non-empty reply of a run that did not complete. */
  partial?: string
  /** The sum of the run's replies. */
  usage: Usage
}

/** Data of the origin entry; a continuation replays it. */
export interface SubagentOrigin {
  parentToolCallId: string
  fork: boolean
  description: string
  /** The model the subagent actually runs on. */
  modelKey: string
}

/** What a subagent's session overrides in the parent's options. */
export interface SubagentSessionOverrides {
  sessionId: string
  transcript: TranscriptEntry[]
  extensionFactories: NonNullable<SubagentSessionOptions['extensionFactories']>
  onEvent: ((event: AgentRuntimeEvent) => void) | undefined
  /** A fork keeps `subagent` registered so its tools match the parent's. */
  fork: boolean
  /**
   * Called before each model request the session makes (its turns and the compaction summaries made
   * for it); a throw refuses the request before it reaches the port or the summarizer.
   */
  beforeModelRequest: () => void
}

export type CreateSubagentSession = (overrides: SubagentSessionOverrides) => Promise<AgentRuntimeSession>

const PLACEHOLDER = 'This tool call was still running when the subagent started; its result is not available here.'

const plainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function toolCallsOf(entry: TranscriptEntry): ToolCallPart[] {
  if (entry.kind !== 'message' || entry.message.role !== 'assistant' || typeof entry.message.content === 'string')
    return []
  return entry.message.content.filter((part): part is ToolCallPart => part.type === 'tool-call')
}

/**
 * The parent's transcript up to the assistant message holding `toolCallId`, every call of that
 * message answered by the same placeholder, so sibling forks send the same prefix.
 */
export function forkTranscript(entries: readonly TranscriptEntry[], toolCallId: string): TranscriptEntry[] {
  // Last: some providers reuse call ids across turns, and the running call is in the latest message.
  const index = entries.findLastIndex((entry) => toolCallsOf(entry).some((call) => call.toolCallId === toolCallId))
  if (index < 0) throw new Error(`No assistant message holds the call ${toolCallId}.`)
  const assistant = entries[index]
  const placeholders = toolCallsOf(assistant).map(
    (call, i): TranscriptMessageEntry => ({
      id: `${assistant.id}-fork-${i}`,
      timestamp: assistant.timestamp,
      kind: 'message',
      message: {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: { type: 'text', value: PLACEHOLDER }
          }
        ]
      }
    })
  )
  return [...entries.slice(0, index + 1), ...placeholders]
}

export const originEntry = (origin: SubagentOrigin): TranscriptStateEntry => ({
  id: `subagent-origin-${origin.parentToolCallId}`,
  timestamp: Date.now(),
  kind: 'state',
  type: SUBAGENT_ORIGIN_STATE,
  data: { ...origin }
})

/**
 * Configures and builds the session of a new subagent. Its start entries (the fork prefix and the
 * origin entry) go to the host's `onEvent` first, so the host stores the whole transcript.
 */
export async function openChild(input: {
  subagent: Subagent
  options: SubagentSessionOptions
  prefix: TranscriptEntry[]
  parentModelKey: string
  createSession: CreateSubagentSession
}): Promise<AgentRuntimeSession> {
  const { subagent, options, prefix } = input
  const transcript = [
    ...prefix,
    originEntry({
      parentToolCallId: subagent.parentToolCallId,
      fork: subagent.fork,
      description: subagent.description,
      modelKey: input.parentModelKey
    })
  ]
  options.onEvent?.({ type: 'transcript-append', entries: plainJson(transcript) })
  const limit = new RequestLimit()
  const child = await input.createSession({
    sessionId: subagent.sessionId,
    transcript,
    fork: subagent.fork,
    extensionFactories: options.extensionFactories ?? [],
    onEvent: options.onEvent,
    beforeModelRequest: limit.beforeModelRequest
  })
  requestLimits.set(child, limit)
  try {
    options.onSessionCreated?.(child.session)
  } catch (error) {
    await child.dispose()
    throw error
  }
  return child
}

/**
 * The request cap of one run, counted where its session makes requests. Past the cap a request is
 * refused before it goes out and the run stops with `limit_reached`.
 */
class RequestLimit {
  private requests = 0
  private onLimit: (() => void) | undefined

  readonly beforeModelRequest = () => {
    if (this.requests >= MAX_SUBAGENT_REQUESTS) {
      this.onLimit?.()
      throw new Error(`The subagent reached its limit of ${MAX_SUBAGENT_REQUESTS} model requests`)
    }
    this.requests++
  }

  whenReached(onLimit: () => void) {
    this.onLimit = onLimit
  }
}

/** The cap of each session `openChild` built; a subagent session serves one run. */
const requestLimits = new WeakMap<AgentRuntimeSession, RequestLimit>()

const zeroUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
})

export function addUsage(sum: Usage, usage: Usage): Usage {
  return {
    input: sum.input + usage.input,
    output: sum.output + usage.output,
    cacheRead: sum.cacheRead + usage.cacheRead,
    cacheWrite: sum.cacheWrite + usage.cacheWrite,
    ...(sum.reasoning === undefined && usage.reasoning === undefined
      ? {}
      : { reasoning: (sum.reasoning ?? 0) + (usage.reasoning ?? 0) }),
    totalTokens: sum.totalTokens + usage.totalTokens,
    cost: {
      input: sum.cost.input + usage.cost.input,
      output: sum.cost.output + usage.cost.output,
      cacheRead: sum.cost.cacheRead + usage.cost.cacheRead,
      cacheWrite: sum.cost.cacheWrite + usage.cost.cacheWrite,
      total: sum.cost.total + usage.cost.total
    }
  }
}

function endOf(last: AssistantMessage | undefined, stopped: 'aborted' | 'limit_reached' | undefined): RunEnd {
  if (stopped) return stopped
  switch (last?.stopReason) {
    case 'stop':
      return 'completed'
    case 'length':
      return 'truncated'
    case 'aborted':
      return 'aborted'
    default:
      return 'failed'
  }
}

const textOf = (message: AssistantMessage) =>
  message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')

/**
 * Runs `task` on the subagent's session until it settles. `signal` stops the run; the result carries
 * the final message (or the reason and last partial output) and the sum of the run's usage.
 */
export async function runSubagent(child: AgentRuntimeSession, task: string, signal: AbortSignal): Promise<RunResult> {
  const { session } = child
  let stopped: 'aborted' | 'limit_reached' | undefined
  const stop = (reason: 'aborted' | 'limit_reached') => {
    stopped ??= reason
    void session.abort()
  }
  requestLimits.get(child)?.whenReached(() => stop('limit_reached'))
  // Not read from `session.messages`: Pi swaps it for the compacted context, dropping folded replies.
  const replies: AssistantMessage[] = []
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'assistant') replies.push(event.message)
    // An abort before the run starts is a no-op in Pi, and the run clears it; repeat it once the run is live.
    if (event.type === 'agent_start' && stopped) void session.abort()
  })
  const onAbort = () => stop('aborted')
  signal.addEventListener('abort', onAbort, { once: true })
  let error: string | undefined
  try {
    if (signal.aborted) stop('aborted')
    else await session.prompt(task, { expandPromptTemplates: false, source: 'extension' })
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
  } finally {
    unsubscribe()
    signal.removeEventListener('abort', onAbort)
  }

  const usage = replies.reduce((sum, reply) => addUsage(sum, reply.usage), zeroUsage())
  const last = replies.at(-1)
  const end = error === undefined ? endOf(last, stopped) : (stopped ?? 'failed')
  if (end === 'completed') return { end, report: textOf(last!).trim(), usage }
  const reason = error ?? (end === 'failed' ? last?.errorMessage : undefined)
  const partial = replies
    .map(textOf)
    .filter((part) => part.trim())
    .at(-1)
  return { end, usage, ...(reason ? { reason } : {}), ...(partial ? { partial } : {}) }
}
