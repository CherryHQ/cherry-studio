import type { AssistantMessage, ToolCall, Usage } from '@earendil-works/pi-ai'
import type { ExtensionFactory, ModelRuntime, SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent'

import type { AgentRuntimeModel, AgentRuntimeSession } from './session'
import type { AgentRuntimeEvent } from './sessionEvents'
import type { Subagent, SubagentSessionOptions } from './subagent'

/** DSH's name: Cherry's renderer shows a cherry-runtime `subagent` call as a Task card. */
export const SUBAGENT_TOOL_NAME = 'subagent'

/** Model requests one run may make before it is stopped (Claude Code's limit for a fork). */
export const MAX_SUBAGENT_REQUESTS = 200

/** State entry naming the call that created a session; it marks a subagent's session. */
export const SUBAGENT_ORIGIN_STATE = 'cherry.subagent-origin'

/** Custom message of a subagent's session: a message the parent sent it with `message_subagent`. */
export const SUBAGENT_MESSAGE_TYPE = 'cherry.subagent-message'

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
  sessionManager: SessionManager
  modelRuntime?: ModelRuntime
  extensionFactories: NonNullable<SubagentSessionOptions['extensionFactories']>
  onEvent: ((event: AgentRuntimeEvent) => void) | undefined
  model: AgentRuntimeModel
  /** A fork keeps `subagent` registered so its tools match the parent's. */
  fork: boolean
  /**
   * Called before each model request the session makes (its turns and the compaction summaries made
   * for it); a throw refuses the request before it reaches the port or the summarizer.
   */
  beforeModelRequest: () => void
}

export type CreateSubagentSession = (overrides: SubagentSessionOverrides) => Promise<AgentRuntimeSession>

/** How a run starts: with the task prompt (a new subagent) or with a message from the parent. */
export type RunStart = { prompt: string } | { message: string; inputId?: string }

interface SubagentInput {
  text: string
  inputId?: string
}

const messageOf = (text: string) => ({ customType: SUBAGENT_MESSAGE_TYPE, content: text, display: false })

/**
 * Messages for a running subagent. While its run goes on they are steered in, so it reads them
 * after its current tool batch; once the run starts to settle they wait for the next run.
 */
export class SubagentInbox {
  private pending: SubagentInput[] = []
  private send: ((input: SubagentInput) => void) | undefined
  private running: () => boolean = () => false
  private holding = false
  private closed = false

  /** The subagent's own extension; it goes ahead of the extensions the host gives the subagent. */
  readonly extension: ExtensionFactory = (pi) => {
    this.send = (input) => pi.sendMessage(messageOf(input.text), { triggerTurn: true, inputId: input.inputId })
    pi.on('session_start', (_event, ctx) => {
      this.running = () => !ctx.isIdle()
    })
    pi.on('turn_start', () => {
      this.holding = false
      for (const input of this.take()) this.send!(input)
    })
    // A steer sent once Pi has decided to settle would stay unread in its queue.
    pi.on('agent_before_settle', () => {
      this.holding = true
    })
  }

  /** False once the run has ended: the message must start a new run instead. */
  push(text: string, inputId?: string): boolean {
    if (this.closed) return false
    const input = { text, inputId }
    if (this.send && this.running() && !this.holding) this.send(input)
    else this.pending.push(input)
    return true
  }

  close(): void {
    this.closed = true
  }

  hasPending(): boolean {
    return this.pending.length > 0
  }

  take(): SubagentInput[] {
    const taken = this.pending
    this.pending = []
    return taken
  }
}

const INTERRUPTED =
  'This tool call was interrupted (the app closed or the turn was stopped); its result is unknown. Check the current state before relying on it.'

/** Origin persisted in the native child branch. */
export function readOrigin(entries: readonly SessionEntry[]): SubagentOrigin | undefined {
  const entry = entries.find(
    (candidate) => candidate.type === 'custom' && candidate.customType === SUBAGENT_ORIGIN_STATE
  )
  return entry?.type === 'custom' ? (entry.data as SubagentOrigin) : undefined
}

/** Close unfinished calls in the native branch before a continuation starts. */
export function answerInterrupted(manager: SessionManager): void {
  const entries = manager.getBranch()
  const index = entries.findLastIndex((entry) => entry.type === 'message' && entry.message.role === 'assistant')
  const entry = entries[index]
  if (entry?.type !== 'message' || entry.message.role !== 'assistant') return
  const reply = entry.message
  if (reply.stopReason === 'error' || reply.stopReason === 'aborted') return
  const answered = new Set(
    entries
      .slice(index + 1)
      .flatMap((entry) =>
        entry.type === 'message' && entry.message.role === 'toolResult' ? [entry.message.toolCallId] : []
      )
  )
  for (const call of reply.content.filter((part): part is ToolCall => part.type === 'toolCall')) {
    if (!answered.has(call.id))
      manager.appendMessage({
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: 'text', text: INTERRUPTED }],
        isError: true,
        timestamp: Date.now()
      })
  }
}

export const nativeModelKey = (model: AgentRuntimeModel): string => `${model.provider}/${model.id}`

/** The model a subagent runs on (spec §6.7). */
export function pickModel(
  subagent: Subagent,
  options: SubagentSessionOptions,
  parentModel: AgentRuntimeModel
): AgentRuntimeModel {
  if (subagent.modelKey !== undefined) {
    if (options.model && nativeModelKey(options.model) === subagent.modelKey) return options.model
    // A host that never picks models runs every subagent on the parent's model.
    if (!options.model && subagent.modelKey === nativeModelKey(parentModel)) return parentModel
    throw new Error(`The subagent needs the model ${subagent.modelKey}, which the app did not provide.`)
  }
  // A fork shares the parent's prompt cache, which another model cannot use.
  if (subagent.fork) return parentModel
  return options.model ?? parentModel
}

/** Opens native child storage; its manager owns persistence before observation starts. */
export async function openChild(input: {
  options: SubagentSessionOptions
  model: AgentRuntimeModel
  sessionManager: SessionManager
  fork: boolean
  inbox: SubagentInbox
  createSession: CreateSubagentSession
}): Promise<AgentRuntimeSession> {
  const { options } = input
  const limit = new RequestLimit()
  const child = await input.createSession({
    sessionManager: input.sessionManager,
    modelRuntime: options.modelRuntime,
    fork: input.fork,
    extensionFactories: [input.inbox.extension, ...(options.extensionFactories ?? [])],
    onEvent: options.onEvent,
    model: input.model,
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

export const zeroUsage = (): Usage => ({
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

/** Starts a run with the parent's messages and waits for it to settle. */
async function runMessages(child: AgentRuntimeSession, inputs: SubagentInput[]): Promise<void> {
  const [first, ...rest] = inputs
  const run = child.session.sendCustomMessage(messageOf(first.text), { triggerTurn: true, inputId: first.inputId })
  // The run is live once the first message started it, so these are steered into it.
  for (const input of rest)
    void child.session.sendCustomMessage(messageOf(input.text), { triggerTurn: true, inputId: input.inputId })
  await run
}

/**
 * Runs the subagent's session until it settles with its inbox empty. `signal` stops the run; the
 * result carries the final message (or the reason and last partial output) and the run's usage.
 */
export async function runSubagent(
  child: AgentRuntimeSession,
  start: RunStart,
  signal: AbortSignal,
  inbox: SubagentInbox
): Promise<RunResult> {
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
    // Pi drops an abort made before it starts preparing the run (while `input` handlers run); repeat it once live.
    if (event.type === 'agent_start' && stopped) void session.abort()
  })
  const onAbort = () => stop('aborted')
  signal.addEventListener('abort', onAbort, { once: true })
  let error: string | undefined
  try {
    if (signal.aborted) stop('aborted')
    else if ('prompt' in start)
      await session.prompt(start.prompt, { expandPromptTemplates: false, source: 'extension' })
    else await runMessages(child, [{ text: start.message, inputId: start.inputId }])
    // Messages that came while the run settled start the next run on the same session.
    while (!stopped && inbox.hasPending()) await runMessages(child, inbox.take())
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
  } finally {
    // In the same tick as the last check, so no message slips in between.
    inbox.close()
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
