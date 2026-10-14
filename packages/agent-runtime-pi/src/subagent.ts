import { randomUUID } from 'node:crypto'

import { Type, type Usage } from '@earendil-works/pi-ai'
import type {
  AgentSession,
  AgentToolResult,
  ExtensionContext,
  ExtensionFactory,
  SessionEntry
} from '@earendil-works/pi-coding-agent'

import type { ToolOutputOffload } from './offload'
import type { ToolApprovalEvent } from './ports'
import type { AgentRuntimeModel, AgentRuntimeSession } from './session'
import { renderStatus, shortenResult, SubagentDelivery } from './subagentDelivery'
import {
  DEFAULT_MAX_BACKGROUND,
  restoreSubagents,
  SUBAGENT_STATE_TYPE,
  type SubagentRecord,
  SubagentRegistry
} from './subagentRegistry'
import {
  answerInterrupted,
  type CreateSubagentSession,
  forkTranscript,
  MAX_SUBAGENT_REQUESTS,
  openChild,
  originEntry,
  pickModel,
  readOrigin,
  type RunEnd,
  type RunResult,
  SUBAGENT_ORIGIN_STATE,
  SUBAGENT_TOOL_NAME,
  SubagentInbox
} from './subagentRun'
import type { TranscriptEntry } from './transcript'
import type { AgentRuntimeEvent } from './transcriptTap'

export { SUBAGENT_MESSAGE_TYPE, SUBAGENT_ORIGIN_STATE, SUBAGENT_TOOL_NAME } from './subagentRun'

export const MESSAGE_SUBAGENT_TOOL_NAME = 'message_subagent'
export const STOP_SUBAGENT_TOOL_NAME = 'stop_subagent'

/** True inside a subagent's session. */
export function isSubagentSession(entries: readonly SessionEntry[]): boolean {
  return entries.some((entry) => entry.type === 'custom' && entry.customType === SUBAGENT_ORIGIN_STATE)
}

/** Host side of `subagent`: gives each subagent its extensions and listeners. */
export interface SubagentPort {
  /**
   * Called before a subagent's session is built: once when it starts and again for each
   * continuation, which must get the same extensions. A throw fails the call. For a fork,
   * `extensionFactories` must yield the parent's tools: the same tools, in the same order.
   */
  configure(subagent: Subagent): SubagentSessionOptions | Promise<SubagentSessionOptions>
  /**
   * The stored transcript of a finished subagent (everything its `onEvent` received), to continue
   * it. Without it, finished subagents cannot be continued.
   */
  load?(sessionId: string): Promise<readonly TranscriptEntry[] | undefined>
  /**
   * Approval events of the subagents' tool calls (the parent's own may come too: they are told
   * apart by `sessionId`, or by call id when an event has none). While one is pending, its subagent
   * shows as `awaiting_approval`.
   */
  onApproval?(listener: (event: ToolApprovalEvent) => void): () => void
  /** Background subagents one parent session may run at once; default 20 (Claude Code's default). */
  maxBackground?: number
  /**
   * Finds models by the name the user said: only enabled models that support tool calls. Without
   * it, `subagent` has no `model` parameter. The package picks among the candidates (spec §6.7).
   */
  findModels?(query: string): Promise<readonly SubagentModelCandidate[]>
}

/** A model `findModels` matched. */
export interface SubagentModelCandidate {
  /** Unique: one model of one provider, the `modelKey` the transcript records. */
  key: string
  /** Display names, e.g. "OpenRouter" and "Claude Sonnet 4.5". */
  provider: string
  model: string
  /** The query is the model name, or the provider and model name, exactly. */
  exact: boolean
}

/** The subagent about to be created or continued. */
export interface Subagent {
  /** The `subagent` call that created it. */
  parentToolCallId: string
  /** When it is continued: the `message_subagent` call that starts this run. */
  continuedBy?: string
  /** Its Pi session id, its requests' `sessionId` and the id the model sees: a random UUID. */
  sessionId: string
  description: string
  fork: boolean
  /** Whether this run is in the background; a continuation always is. */
  background: boolean
  /**
   * The model the host must give it: the one the `model` parameter named (unset otherwise: the host
   * picks its default subagent model), or for a continuation the one its first run used. When it is
   * the parent's current model, the host may give none.
   */
  modelKey?: string
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
  /**
   * The model it runs on. Required for `Subagent.modelKey` (that key's model), or the launch or
   * continuation fails, unless that key is the parent's current model, which runs it when this is
   * unset; otherwise the host's default subagent model, the parent's when unset. Ignored for a new
   * fork, which keeps the parent's model.
   */
  model?: AgentRuntimeModel
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

/**
 * `details` of a `message_subagent` result: the message joined the running run, or started run `run`
 * in the background. Calls that throw carry none.
 */
export type SubagentMessageDetails =
  | { sessionId: string; continued: false }
  | { sessionId: string; continued: true; run: number }

/**
 * `details` of a `stop_subagent` result: the run it stopped and that run's usage (no notification
 * follows to carry it), or `stopped: false` when the subagent was not running. Calls that throw carry none.
 */
export type SubagentStopDetails =
  | { sessionId: string; stopped: true; run: number; usage: Usage }
  | { sessionId: string; stopped: false }

/** What the session that registers `subagent` lends it. */
export interface SubagentToolOptions {
  port: SubagentPort
  /** Builds a session from the parent's options with these overrides. */
  createSession: CreateSubagentSession
  /** The parent's transcript so far, including the running turn. */
  parentTranscript: () => readonly TranscriptEntry[]
  /** The parent's model, a subagent's unless the host gives it another. */
  parentModel: AgentRuntimeModel
  /** The parent's `onEvent`. */
  emit: (event: AgentRuntimeEvent) => void
  /** The parent's offload, also used for long results in notifications. */
  offload: ToolOutputOffload | undefined
}

/** Pi event-bus channel on which this extension hands the goal extension its link (spec §11.4). */
export const SUBAGENT_GOAL_LINK = 'cherry.subagent-goal-link'

/** What the goal extension of the same session asks of its subagents; internal to the package. */
export interface SubagentGoalLink {
  /** Background subagents running or waiting for an approval. */
  runningBackground(): number
  /** Stops those of `sessionIds` still running, as the goal's budget is used up. */
  stopForBudget(sessionIds: Iterable<string>): void
  /** While `refusal()` returns a message, background launches and continuations fail with it. */
  guardBackground(refusal: () => string | undefined): void
}

/** What the parent's `AgentRuntimeSession` reaches through to its subagents. */
export interface SubagentControls {
  /** Held by a host prompt or compaction until it returns; no notification starts a run meanwhile. */
  hold(): () => void
  /** The user stops a background subagent; false when it is not running. */
  stopSubagent(sessionId: string): boolean
  /** The user moves a running foreground subagent to the background; false for any other. */
  backgroundSubagent(sessionId: string): boolean
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
const RECOVERY_HINT =
  'Your previous run was interrupted. Check the current state of the workspace first and do not redo work that is already done.'

const STOPPED_BY: Record<SubagentStopper, string> = {
  model: 'stopped by you',
  user: 'stopped by the user',
  budget: "stopped because the goal's budget is used up"
}

/** A subagent's state in the words lists of subagents use. */
function statusText(record: SubagentRecord): string {
  if (record.status === 'running') return 'running'
  if (record.status === 'awaiting_approval') return 'waiting for a tool approval'
  return record.stoppedBy ? STOPPED_BY[record.stoppedBy] : record.outcome!
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

const movedText = (sessionId: string) =>
  `The user moved this subagent to the background (id: ${sessionId}); it keeps working. You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work. Continue with what the user asks next.`

const startedText = (sessionId: string) =>
  `Subagent started in the background (id: ${sessionId}). You will be notified when it finishes. Do not wait, poll or guess its result, and do not redo its work or edit the files it is working on. Continue with independent work, or end your turn.`

const notStarted = (sessionId: string, fork: boolean): AgentToolResult<SubagentDetails> => ({
  content: [text('The subagent was not started because the turn was aborted.')],
  details: { sessionId, fork, background: false, outcome: 'aborted' },
  isError: true
})

const FORK_WITH_MODEL =
  "A fork shares this conversation's prompt cache and must use the current model; drop model or fork."
/** Similar names an unmatched `model` error lists. */
const SIMILAR = 5

/** The key of the one model `query` names (spec §6.7); several or none throw for the model to resolve. */
async function resolveModel(port: SubagentPort, query: string): Promise<string> {
  const found = await port.findModels!(query)
  const exact = found.filter((candidate) => candidate.exact)
  const name = (candidate: SubagentModelCandidate) => `${candidate.provider} / ${candidate.model}`
  if (exact.length === 1) return exact[0].key
  if (exact.length > 1)
    throw new Error(
      [
        `Several models match "${query}":`,
        ...exact.map((candidate) => `- ${name(candidate)}`),
        'Ask the user which one to use, then call subagent again with the provider and model name.'
      ].join('\n')
    )
  const similar = found.slice(0, SIMILAR).map(name)
  throw new Error(
    `No enabled model with tool support matches "${query}".${similar.length > 0 ? ` Similar: ${similar.join(', ')}` : ''}`
  )
}

const baseParameters = {
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
}
const parameters = Type.Object(baseParameters)
const parametersWithModel = Type.Object({
  ...baseParameters,
  model: Type.Optional(
    Type.String({
      description:
        'Only when the user (or the agent instructions) names a model for this task: the name as they said it, with the provider if they gave one, e.g. "OpenRouter Claude Sonnet 4.5". Leave it out otherwise.'
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
  parentModel,
  emit,
  offload
}: SubagentToolOptions): { extension: ExtensionFactory; controls: SubagentControls } {
  // Set once the main session starts; a fork's copy of this extension stays unreachable.
  let main: { registry: SubagentRegistry; delivery: SubagentDelivery } | undefined
  const controls: SubagentControls = {
    hold: () => main?.delivery.hold() ?? (() => {}),
    stopSubagent: (sessionId) =>
      main?.registry.get(sessionId)?.background === true && main.registry.stop(sessionId, 'user') !== undefined,
    backgroundSubagent: (sessionId) => main?.registry.moveToBackground(sessionId) ?? false
  }
  const extension: ExtensionFactory = (pi) => {
    let ctx: ExtensionContext | undefined
    let inSubagent = false
    let unsubscribeApproval: (() => void) | undefined
    let backgroundRefusal: () => string | undefined = () => undefined
    const assertBackgroundAllowed = () => {
      const refusal = backgroundRefusal()
      if (refusal) throw new Error(refusal)
    }
    const registry = new SubagentRegistry({
      appendState: (state) => pi.appendEntry(SUBAGENT_STATE_TYPE, state),
      emit,
      maxBackground: port.maxBackground ?? DEFAULT_MAX_BACKGROUND,
      shorten: (record, result) =>
        shortenResult(result, offload, { toolCallId: record.parentToolCallId, toolName: SUBAGENT_TOOL_NAME }),
      finished: (record, result) =>
        delivery.enqueue({
          sessionId: record.sessionId,
          run: record.run,
          description: record.description,
          outcome: record.outcome!,
          ...(record.stoppedBy === undefined ? {} : { stoppedBy: record.stoppedBy }),
          ...(result.report === undefined ? {} : { report: result.report }),
          ...(result.reason === undefined ? {} : { reason: result.reason }),
          ...(result.partial === undefined ? {} : { partial: result.partial }),
          usage: result.usage,
          // The user only needs the parent to know; that is no reason to start a turn.
          wake: record.stoppedBy !== 'user'
        })
    })
    const delivery = new SubagentDelivery({
      startTurn: (message) => pi.sendMessage(message, { triggerTurn: true }),
      isIdle: () => ctx?.isIdle() ?? false,
      runningBackground: () => registry.runningBackground().length
    })

    pi.on('session_start', (_event, context) => {
      // A fork keeps this extension so its tools match the parent's; it delivers nothing.
      const branch = context.sessionManager.getBranch()
      inSubagent = isSubagentSession(branch)
      if (inSubagent) return
      ctx = context
      main = { registry, delivery }
      const { records, undelivered } = restoreSubagents(branch, parentModel.key)
      registry.restore(records)
      delivery.restore(undelivered)
      unsubscribeApproval = port.onApproval?.((event) => registry.approval(event))
      const link: SubagentGoalLink = {
        runningBackground: () => registry.runningBackground().length,
        stopForBudget: (sessionIds) => {
          for (const sessionId of sessionIds) void registry.stop(sessionId, 'budget')
        },
        guardBackground: (refusal) => (backgroundRefusal = refusal)
      }
      pi.events.emit(SUBAGENT_GOAL_LINK, link)
    })
    // After a compaction the model no longer sees its subagent calls; this keeps it from starting them again.
    pi.on('session_compact', () => {
      if (inSubagent) return
      const status = renderStatus(registry.runningBackground(), delivery.pending())
      if (status) pi.sendMessage(status, { triggerTurn: false })
    })
    pi.on('agent_before_settle', (event) => (inSubagent ? undefined : delivery.beforeSettle(event)))
    pi.on('agent_settled', (event) => {
      if (!inSubagent) delivery.settled(event.aborted)
    })
    pi.on('before_agent_start', () => (inSubagent ? undefined : delivery.beforeAgentStart()))
    pi.on('session_shutdown', () => {
      unsubscribeApproval?.()
      unsubscribeApproval = undefined
      delivery.close()
      return registry.close()
    })

    pi.registerTool({
      name: SUBAGENT_TOOL_NAME,
      label: 'Subagent',
      description: DESCRIPTION,
      // Without findModels the host cannot honor a model, so the model is not offered one.
      parameters: (port.findModels ? parametersWithModel : parameters) as typeof parametersWithModel,
      exposure: 'model-only',
      async execute(toolCallId, params, signal, _onUpdate, ctx) {
        if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error(IN_SUBAGENT)
        const description = params.description.trim()
        const prompt = params.prompt.trim()
        if (!description || !prompt) throw new Error('A subagent needs a non-empty description and prompt.')
        const fork = params.fork ?? false
        const background = params.background ?? false
        const named = port.findModels ? params.model?.trim() : undefined
        if (named && fork) throw new Error(FORK_WITH_MODEL)
        const subagent: Subagent = {
          parentToolCallId: toolCallId,
          sessionId: randomUUID(),
          description,
          fork,
          background,
          ...(named ? { modelKey: await resolveModel(port, named) } : {})
        }
        if (background) assertBackgroundAllowed()
        const release = background ? registry.reserveBackground() : () => {}
        const inbox = new SubagentInbox()
        let child: AgentRuntimeSession
        let modelKey: string
        try {
          // Built before `configure`, so a failure building the fork transcript never reaches the host.
          const prefix = fork ? forkTranscript(parentTranscript(), toolCallId) : []
          const options = await port.configure(subagent)
          // A background subagent does not belong to the turn, so the turn's abort does not cancel it.
          if (!background && signal?.aborted) return notStarted(subagent.sessionId, fork)
          const model = pickModel(subagent, options, parentModel)
          modelKey = model.key
          const startEntries = [...prefix, originEntry({ parentToolCallId: toolCallId, fork, description, modelKey })]
          child = await openChild({
            subagent,
            options,
            model,
            transcript: startEntries,
            handOff: startEntries,
            inbox,
            createSession
          })
        } finally {
          release()
        }
        const record: SubagentRecord = {
          sessionId: subagent.sessionId,
          parentToolCallId: toolCallId,
          description,
          fork,
          background,
          modelKey,
          run: 1,
          status: 'running'
        }
        const start = { prompt: taskText(prompt) }
        if (background) {
          registry.startBackground(record, child, start, inbox)
          const details: SubagentDetails = { sessionId: subagent.sessionId, fork, background: true }
          return { content: [text(startedText(subagent.sessionId))], details }
        }
        const result = await registry.runForeground(record, child, start, inbox, signal)
        if (!result) {
          const details: SubagentDetails = { sessionId: subagent.sessionId, fork, background: true }
          return { content: [text(movedText(subagent.sessionId))], details }
        }
        const details: SubagentDetails = { sessionId: subagent.sessionId, fork, background: false, outcome: result.end }
        return {
          content: [text(`${runText(result)}\n\n${idTrailer(subagent.sessionId)}`)],
          details,
          usage: result.usage,
          ...(result.end === 'completed' ? {} : { isError: true })
        }
      }
    })

    /** A finished subagent's next run, in the background, from the transcript the host stored. */
    const continueSubagent = async (record: SubagentRecord, message: string, toolCallId: string) => {
      const id = record.sessionId
      assertBackgroundAllowed()
      const release = registry.reserveBackground()
      const inbox = new SubagentInbox()
      let child: AgentRuntimeSession
      try {
        const stored = await port.load!(id)
        const origin = stored && readOrigin(stored)
        if (!stored || !origin) throw new Error(`Subagent ${id} cannot be continued: its transcript is not available.`)
        const subagent: Subagent = {
          parentToolCallId: origin.parentToolCallId,
          continuedBy: toolCallId,
          sessionId: id,
          description: origin.description,
          fork: origin.fork,
          background: true,
          modelKey: origin.modelKey
        }
        const options = await port.configure(subagent)
        const model = pickModel(subagent, options, parentModel)
        record.modelKey = model.key
        const answers = answerInterrupted(stored)
        child = await openChild({
          subagent,
          options,
          model,
          transcript: [...stored, ...answers],
          handOff: answers,
          inbox,
          createSession
        })
      } finally {
        release()
      }
      const interrupted = record.outcome === 'interrupted' || record.outcome === 'aborted'
      record.run++
      registry.startBackground(
        record,
        child,
        { message: interrupted ? `${RECOVERY_HINT}\n\n${message}` : message },
        inbox
      )
      const details: SubagentMessageDetails = { sessionId: id, continued: true, run: record.run }
      return {
        content: [
          text(`Subagent ${id} resumed in the background with your message; you will be notified when it finishes.`)
        ],
        details
      }
    }

    pi.registerTool({
      name: MESSAGE_SUBAGENT_TOOL_NAME,
      label: 'Message subagent',
      description:
        'Send a message to a subagent you started, by the id its result or notification gave. A running subagent reads it after its current step.',
      parameters: messageParameters,
      exposure: 'model-only',
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error(IN_SUBAGENT)
        const id = params.id.trim()
        const message = params.message.trim()
        if (!message) throw new Error('message_subagent needs a non-empty message.')
        const record = registry.get(id)
        if (!record) throw new Error(unknownId(id, registry))
        // Another message may be continuing it right now; this one then goes to that run.
        for (let lock = registry.continuationLock(id); lock; lock = registry.continuationLock(id))
          await lock.catch(() => undefined)
        // A run being stopped would drop the message; it is answered once the stop is recorded.
        if (record.status !== 'finished' && !record.stoppedBy && registry.queueMessage(id, message)) {
          const details: SubagentMessageDetails = { sessionId: id, continued: false }
          return { content: [text(`Message queued for subagent ${id}; it reads it after its current step.`)], details }
        }
        return registry.withContinuationLock(id, async () => {
          // A run that has just ended is recorded before the next one starts.
          await registry.whenRecorded(id)
          if (record.stoppedBy === 'user')
            throw new Error(
              `Subagent ${id} was stopped by the user and cannot be continued. Start a new subagent if the work is still needed.`
            )
          if (!port.load)
            throw new Error(
              `Subagent ${id} has finished and this app cannot continue finished subagents. Start a new subagent instead.`
            )
          return continueSubagent(record, message, toolCallId)
        })
      }
    })

    pi.registerTool({
      name: STOP_SUBAGENT_TOOL_NAME,
      label: 'Stop subagent',
      description:
        'Stop a running subagent by its id and get its partial output. You get no notification for it afterwards; message_subagent can continue it later.',
      parameters: Type.Object({ id: Type.String({ description: 'The id a subagent result or notification gave.' }) }),
      exposure: 'model-only',
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error(IN_SUBAGENT)
        const id = params.id.trim()
        const record = registry.get(id)
        if (!record) throw new Error(unknownId(id, registry))
        const stopped = registry.stop(id, 'model')
        if (!stopped) {
          const details: SubagentStopDetails = { sessionId: id, stopped: false }
          return { content: [text(`Subagent ${id} is not running (${statusText(record)}).`)], details }
        }
        const { run } = record
        const result = await stopped
        const partial = result.partial ?? result.report
        const details: SubagentStopDetails = { sessionId: id, stopped: true, run, usage: result.usage }
        return {
          content: [
            text(
              partial
                ? `Stopped subagent ${id}. Partial output before it stopped:\n${partial}`
                : `Stopped subagent ${id}.`
            )
          ],
          details
        }
      }
    })
  }
  return { extension, controls }
}
