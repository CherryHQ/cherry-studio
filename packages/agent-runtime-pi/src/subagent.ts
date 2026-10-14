import { randomUUID } from 'node:crypto'

import { Type } from '@earendil-works/pi-ai'
import type {
  AgentSession,
  AgentToolResult,
  ExtensionContext,
  ExtensionFactory,
  SessionEntry
} from '@earendil-works/pi-coding-agent'

import type { ToolOutputOffload } from './offload'
import type { AgentRuntimeSession } from './session'
import { shortenResult, SubagentDelivery } from './subagentDelivery'
import { DEFAULT_MAX_BACKGROUND, SUBAGENT_STATE_TYPE, type SubagentRecord, SubagentRegistry } from './subagentRegistry'
import {
  type CreateSubagentSession,
  forkTranscript,
  MAX_SUBAGENT_REQUESTS,
  openChild,
  type RunEnd,
  type RunResult,
  SUBAGENT_ORIGIN_STATE,
  SubagentInbox
} from './subagentRun'
import type { TranscriptEntry } from './transcript'
import type { AgentRuntimeEvent } from './transcriptTap'

export { SUBAGENT_MESSAGE_TYPE, SUBAGENT_ORIGIN_STATE } from './subagentRun'

/** DSH's name: Cherry's renderer shows a cherry-runtime `subagent` call as a Task card. */
export const SUBAGENT_TOOL_NAME = 'subagent'
export const MESSAGE_SUBAGENT_TOOL_NAME = 'message_subagent'

/** True inside a subagent's session. */
export function isSubagentSession(entries: readonly SessionEntry[]): boolean {
  return entries.some((entry) => entry.type === 'custom' && entry.customType === SUBAGENT_ORIGIN_STATE)
}

/** Host side of `subagent`: gives each subagent its extensions and listeners. */
export interface SubagentPort {
  /**
   * Called once per subagent, before its session is built. A throw fails the call. For a fork,
   * `extensionFactories` must yield the parent's tools: the same tools, in the same order.
   */
  configure(subagent: Subagent): SubagentSessionOptions | Promise<SubagentSessionOptions>
  /** Background subagents one parent session may run at once; default 20 (Claude Code's default). */
  maxBackground?: number
}

/** The subagent about to be created. */
export interface Subagent {
  /** The `subagent` call that creates it. */
  parentToolCallId: string
  /** Its Pi session id, its requests' `sessionId` and the id the model sees: a random UUID. */
  sessionId: string
  description: string
  fork: boolean
  /** Whether this run is in the background. */
  background: boolean
}

/** The session options the host gives each subagent; everything else comes from the parent. */
export interface SubagentSessionOptions {
  extensionFactories?: ExtensionFactory[]
  /**
   * The subagent's own transcript events, shaped like the parent's `onEvent`; they never reach the
   * parent's. The first `transcript-append` holds its start entries (fork prefix and origin entry).
   */
  onEvent?: (event: AgentRuntimeEvent) => void
  /** Called before the subagent's first model request; subscribe to its live output here. */
  onSessionCreated?: (session: AgentSession) => void
}

/** How a subagent's run ended. */
export type SubagentOutcome = RunEnd | 'stopped' | 'interrupted'

/** Who stopped a run that ended `stopped`. */
export type SubagentStopper = 'model' | 'user' | 'budget'

/**
 * `details` of every result the tool returns once the subagent's session is built, and of a call
 * aborted before then. Calls that throw carry none, `onSessionCreated` throwing included.
 */
export type SubagentDetails =
  | { sessionId: string; fork: boolean; background: false; outcome: SubagentOutcome }
  | { sessionId: string; fork: boolean; background: true }

/** What the session that registers `subagent` lends it. */
export interface SubagentToolOptions {
  port: SubagentPort
  /** Builds a session from the parent's options with these overrides. */
  createSession: CreateSubagentSession
  /** The parent's transcript so far, including the running turn. */
  parentTranscript: () => readonly TranscriptEntry[]
  /** Key of the parent's model, recorded as the model a subagent runs on. */
  parentModelKey: string
  /** The parent's `onEvent`. */
  emit: (event: AgentRuntimeEvent) => void
  /** The parent's offload, also used for long results in notifications. */
  offload: ToolOutputOffload | undefined
}

/** What the parent's `AgentRuntimeSession` reaches through to its subagents. */
export interface SubagentControls {
  /** Held by a host prompt or compaction until it returns; no notification starts a run meanwhile. */
  hold(): () => void
}

const DESCRIPTION = [
  'Delegate a task to a subagent: a separate agent with the same tools that returns only its final report, so the work does not fill this conversation.',
  '- By default the subagent starts with an empty context: put everything it needs in the prompt.',
  '- With fork: true it starts from this conversation as it is now, so the prompt needs only what is new.',
  '- Start independent subagents together in one message; they run at the same time.',
  '- You see the final report, not the intermediate steps.',
  '- Run it in the foreground when you need its result to go on. Use background: true only when you have independent work to do meanwhile; you are notified when it finishes.'
].join('\n')

const PREAMBLE =
  'You are a subagent working for another agent, not for the user. Do the task below with your tools, then finish with one final message that reports the result in full — the other agent sees only that final message. You cannot ask the user questions and you cannot start subagents.'

const NO_FINAL_MESSAGE = 'The subagent finished without a final message.'

const STOPPED: Record<Exclude<RunEnd, 'completed'>, string> = {
  failed: 'The subagent failed',
  truncated: 'The subagent hit its output limit before finishing',
  aborted: 'The subagent was stopped because the turn was aborted',
  limit_reached: `The subagent was stopped after ${MAX_SUBAGENT_REQUESTS} model requests`
}

const text = (value: string) => ({ type: 'text' as const, text: value })
const taskText = (prompt: string) => `${PREAMBLE}\n\nTask:\n${prompt}`
const idTrailer = (sessionId: string) => `(id: ${sessionId} — continue this subagent with message_subagent.)`

/** The L4 result text: the final message, or why the run stopped and its last partial output. */
function runText(result: RunResult): string {
  if (result.end === 'completed') return result.report || NO_FINAL_MESSAGE
  const lines = [result.reason ? `${STOPPED[result.end]}: ${result.reason}` : `${STOPPED[result.end]}.`]
  if (result.partial) lines.push(`Partial output before it stopped:\n${result.partial}`)
  return lines.join('\n')
}

const IN_SUBAGENT = 'Subagents cannot start or manage subagents.'

/** A subagent's state in the words lists of subagents use. */
function statusText(record: SubagentRecord): string {
  if (record.status === 'running') return 'running'
  if (record.status === 'awaiting_approval') return 'waiting for a tool approval'
  return record.outcome!
}

function unknownId(id: string, registry: SubagentRegistry): string {
  const listed = registry
    .recent()
    .map((record) => `${record.sessionId} — ${record.description} — ${statusText(record)}`)
  const head = `No subagent with id ${id} in this conversation.`
  return listed.length === 0 ? head : [`${head} Subagents you can address:`, ...listed].join('\n')
}

const messageParameters = Type.Object({
  id: Type.String({ description: 'The id a subagent result or notification gave.' }),
  message: Type.String({ description: 'What to tell the subagent.' })
})

const startedText = (sessionId: string) =>
  `Subagent started in the background (id: ${sessionId}). You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work or edit the files it is working on. Continue with independent work, or end your turn.`

const notStarted = (sessionId: string, fork: boolean): AgentToolResult<SubagentDetails> => ({
  content: [text('The subagent was not started because the turn was aborted.')],
  details: { sessionId, fork, background: false, outcome: 'aborted' },
  isError: true
})

const parameters = Type.Object({
  description: Type.String({ description: 'A short (3-5 word) title of the task, shown to the user.' }),
  prompt: Type.String({ description: 'The task for the subagent.' }),
  fork: Type.Optional(
    Type.Boolean({
      description: 'Start from this conversation as it is now instead of an empty context. Default false.'
    })
  ),
  background: Type.Optional(
    Type.Boolean({
      description:
        'Return at once and let the subagent work in the background; you are notified when it finishes. Default false.'
    })
  )
})

/**
 * The `subagent` tool and the delivery of background results. Each call runs a subagent session
 * in-process; a foreground call returns its final report, a background one returns at once.
 */
export function createSubagentExtension({
  port,
  createSession,
  parentTranscript,
  parentModelKey,
  emit,
  offload
}: SubagentToolOptions): { extension: ExtensionFactory; controls: SubagentControls } {
  let delivery: SubagentDelivery | undefined
  const controls: SubagentControls = { hold: () => delivery?.hold() ?? (() => {}) }
  const extension: ExtensionFactory = (pi) => {
    let ctx: ExtensionContext | undefined
    let inSubagent = false
    const registry = new SubagentRegistry({
      appendState: (state) => pi.appendEntry(SUBAGENT_STATE_TYPE, state),
      emit,
      maxBackground: port.maxBackground ?? DEFAULT_MAX_BACKGROUND,
      shorten: (record, result) =>
        shortenResult(result, offload, { toolCallId: record.parentToolCallId, toolName: SUBAGENT_TOOL_NAME }),
      finished: (record, result) =>
        delivery?.enqueue({
          sessionId: record.sessionId,
          run: record.run,
          description: record.description,
          outcome: record.outcome!,
          ...(result.report === undefined ? {} : { report: result.report }),
          ...(result.reason === undefined ? {} : { reason: result.reason }),
          ...(result.partial === undefined ? {} : { partial: result.partial }),
          usage: result.usage,
          wake: true
        })
    })
    const parentDelivery = new SubagentDelivery({
      startTurn: (message) => pi.sendMessage(message, { triggerTurn: true }),
      isIdle: () => ctx?.isIdle() ?? false,
      stillRunning: () => registry.runningBackground()
    })

    pi.on('session_start', (_event, context) => {
      // A fork keeps this extension so its tools match the parent's; it delivers nothing.
      inSubagent = isSubagentSession(context.sessionManager.getBranch())
      if (inSubagent) return
      ctx = context
      delivery = parentDelivery
    })
    pi.on('agent_before_settle', (event) => (inSubagent ? undefined : parentDelivery.beforeSettle(event)))
    pi.on('agent_settled', (event) => {
      if (!inSubagent) parentDelivery.settled(event.aborted)
    })
    pi.on('before_agent_start', () => (inSubagent ? undefined : parentDelivery.beforeAgentStart()))
    pi.on('session_shutdown', () => {
      parentDelivery.close()
      return registry.close()
    })

    pi.registerTool({
      name: SUBAGENT_TOOL_NAME,
      label: 'Subagent',
      description: DESCRIPTION,
      parameters,
      exposure: 'model-only',
      async execute(toolCallId, params, signal, _onUpdate, ctx) {
        if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error(IN_SUBAGENT)
        const description = params.description.trim()
        const prompt = params.prompt.trim()
        if (!description || !prompt) throw new Error('A subagent needs a non-empty description and prompt.')
        const fork = params.fork ?? false
        const background = params.background ?? false
        const subagent: Subagent = {
          parentToolCallId: toolCallId,
          sessionId: randomUUID(),
          description,
          fork,
          background
        }
        const release = background ? registry.reserveBackground() : () => {}
        const inbox = new SubagentInbox()
        let child: AgentRuntimeSession
        try {
          // Built before `configure`, so a failure building the fork transcript never reaches the host.
          const prefix = fork ? forkTranscript(parentTranscript(), toolCallId) : []
          const options = await port.configure(subagent)
          // A background subagent does not belong to the turn, so the turn's abort does not cancel it.
          if (!background && signal?.aborted) return notStarted(subagent.sessionId, fork)
          child = await openChild({ subagent, options, prefix, parentModelKey, inbox, createSession })
        } finally {
          release()
        }
        const record: SubagentRecord = {
          sessionId: subagent.sessionId,
          parentToolCallId: toolCallId,
          description,
          fork,
          background,
          modelKey: parentModelKey,
          run: 1,
          status: 'running'
        }
        const start = { prompt: taskText(prompt) }
        if (background) {
          registry.startBackground(record, child, start, inbox)
          const details: SubagentDetails = { sessionId: subagent.sessionId, fork, background: true }
          return { content: [text(startedText(subagent.sessionId))], details }
        }
        try {
          const result = await registry.runForeground(record, child, start, inbox, signal)
          const details: SubagentDetails = {
            sessionId: subagent.sessionId,
            fork,
            background: false,
            outcome: result.end
          }
          return {
            content: [text(`${runText(result)}\n\n${idTrailer(subagent.sessionId)}`)],
            details,
            usage: result.usage,
            ...(result.end === 'completed' ? {} : { isError: true })
          }
        } finally {
          await child.dispose()
        }
      }
    })

    pi.registerTool({
      name: MESSAGE_SUBAGENT_TOOL_NAME,
      label: 'Message subagent',
      description:
        'Send a message to a subagent you started, by the id its result or notification gave. A running subagent reads it after its current step.',
      parameters: messageParameters,
      exposure: 'model-only',
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error(IN_SUBAGENT)
        const id = params.id.trim()
        const message = params.message.trim()
        if (!message) throw new Error('message_subagent needs a non-empty message.')
        const record = registry.get(id)
        if (!record) throw new Error(unknownId(id, registry))
        if (record.status === 'finished' || !registry.message(id, message))
          throw new Error(
            `Subagent ${id} has finished and this app cannot continue finished subagents. Start a new subagent instead.`
          )
        return {
          content: [text(`Message queued for subagent ${id}; it reads it after its current step.`)],
          details: undefined
        }
      }
    })
  }
  return { extension, controls }
}
