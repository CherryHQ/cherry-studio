import { randomUUID } from 'node:crypto'

import { Type } from '@earendil-works/pi-ai'
import type { AgentSession, AgentToolResult, ExtensionFactory, SessionEntry } from '@earendil-works/pi-coding-agent'

import {
  type CreateSubagentSession,
  forkTranscript,
  MAX_SUBAGENT_REQUESTS,
  openChild,
  type RunEnd,
  type RunResult,
  runSubagent,
  SUBAGENT_ORIGIN_STATE
} from './subagentRun'
import type { TranscriptEntry } from './transcript'
import type { AgentRuntimeEvent } from './transcriptTap'

export { SUBAGENT_ORIGIN_STATE } from './subagentRun'

/** DSH's name: Cherry's renderer shows a cherry-runtime `subagent` call as a Task card. */
export const SUBAGENT_TOOL_NAME = 'subagent'

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
}

const DESCRIPTION = [
  'Delegate a task to a subagent: a separate agent with the same tools that returns only its final report, so the work does not fill this conversation.',
  '- By default the subagent starts with an empty context: put everything it needs in the prompt.',
  '- With fork: true it starts from this conversation as it is now, so the prompt needs only what is new.',
  '- Start independent subagents together in one message; they run at the same time.',
  '- You see the final report, not the intermediate steps.'
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
  )
})

/** The `subagent` tool: each call runs a subagent session in-process and returns its final report. */
export function subagentExtension({
  port,
  createSession,
  parentTranscript,
  parentModelKey
}: SubagentToolOptions): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: SUBAGENT_TOOL_NAME,
      label: 'Subagent',
      description: DESCRIPTION,
      parameters,
      exposure: 'model-only',
      async execute(toolCallId, params, signal, _onUpdate, ctx) {
        if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error('Subagents cannot start subagents.')
        const description = params.description.trim()
        const prompt = params.prompt.trim()
        if (!description || !prompt) throw new Error('A subagent needs a non-empty description and prompt.')
        const fork = params.fork ?? false
        const subagent: Subagent = {
          parentToolCallId: toolCallId,
          sessionId: randomUUID(),
          description,
          fork,
          background: false
        }
        // Built before `configure`, so a failure building the fork transcript never reaches the host.
        const prefix = fork ? forkTranscript(parentTranscript(), toolCallId) : []
        const options = await port.configure(subagent)
        if (signal?.aborted) return notStarted(subagent.sessionId, fork)
        const child = await openChild({ subagent, options, prefix, parentModelKey, createSession })
        try {
          const run = new AbortController()
          const onAbort = () => run.abort()
          if (signal?.aborted) run.abort()
          else signal?.addEventListener('abort', onAbort, { once: true })
          const result = await runSubagent(child, taskText(prompt), run.signal).finally(() =>
            signal?.removeEventListener('abort', onAbort)
          )
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
  }
}
