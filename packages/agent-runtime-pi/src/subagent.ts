import { type AssistantMessage, Type, type Usage } from '@earendil-works/pi-ai'
import type { AgentSession, AgentToolResult, ExtensionFactory, SessionEntry } from '@earendil-works/pi-coding-agent'
import type { ToolCallPart } from 'ai'

import type { AgentRuntimeSession } from './session'
import type { TranscriptEntry, TranscriptMessageEntry, TranscriptStateEntry } from './transcript'
import type { AgentRuntimeEvent } from './transcriptTap'

/** DSH's name: Cherry's renderer shows a cherry-runtime `subagent` call as a Task card. */
export const SUBAGENT_TOOL_NAME = 'subagent'

/** State entry naming the call that created a session; it marks a subagent's session. */
export const SUBAGENT_ORIGIN_STATE = 'cherry.subagent-origin'

/** True inside a subagent's session. */
export function isSubagentSession(entries: readonly SessionEntry[]): boolean {
  return entries.some((entry) => entry.type === 'custom' && entry.customType === SUBAGENT_ORIGIN_STATE)
}

const originEntry = (subagent: Subagent): TranscriptStateEntry => ({
  id: `subagent-origin-${subagent.parentToolCallId}`,
  timestamp: Date.now(),
  kind: 'state',
  type: SUBAGENT_ORIGIN_STATE,
  data: { parentToolCallId: subagent.parentToolCallId, fork: subagent.fork }
})

const PLACEHOLDER = 'This tool call was still running when the subagent started; its result is not available here.'

function toolCallsOf(entry: TranscriptEntry): ToolCallPart[] {
  if (entry.kind !== 'message' || entry.message.role !== 'assistant' || typeof entry.message.content === 'string')
    return []
  return entry.message.content.filter((part): part is ToolCallPart => part.type === 'tool-call')
}

/**
 * The parent's transcript up to the assistant message holding `toolCallId`, every call of that
 * message answered by the same placeholder, so sibling forks send the same prefix.
 */
function forkTranscript(entries: readonly TranscriptEntry[], toolCallId: string): TranscriptEntry[] {
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

/** Host side of `subagent`: gives each subagent its extensions and listeners. */
export interface SubagentPort {
  /** Called once per subagent, before its session is built. A throw fails the call. */
  configure(subagent: Subagent): SubagentSessionOptions | Promise<SubagentSessionOptions>
}

/** The subagent about to be created. */
export interface Subagent {
  /** The `subagent` call that creates it. */
  parentToolCallId: string
  /** Its Pi session id and its requests' `sessionId`: `<parent session id>.<parentToolCallId>`, characters Pi rejects replaced by `-`. */
  sessionId: string
  fork: boolean
}

/** The session options the host gives each subagent; everything else comes from the parent. */
export interface SubagentSessionOptions {
  extensionFactories?: ExtensionFactory[]
  /** The subagent's own transcript events, shaped like the parent's `onEvent`; they never reach the parent's. */
  onEvent?: (event: AgentRuntimeEvent) => void
  /** Called before the subagent's first model request; subscribe to its live output here. */
  onSessionCreated?: (session: AgentSession) => void
}

/** `details` of every result the tool returns once the host configured the subagent. */
export interface SubagentDetails {
  sessionId: string
  fork: boolean
  outcome: 'completed' | 'failed' | 'truncated' | 'aborted' | 'limit_reached'
}

/** What a subagent's session overrides in the parent's options. */
export interface SubagentSessionOverrides {
  sessionId: string
  transcript: TranscriptEntry[]
  extensionFactories: ExtensionFactory[]
  onEvent: ((event: AgentRuntimeEvent) => void) | undefined
  /** A fork keeps `subagent` registered so its tools match the parent's. */
  fork: boolean
}

/** What the session that registers `subagent` lends it. */
export interface SubagentToolOptions {
  port: SubagentPort
  /** Builds a session from the parent's options with these overrides. */
  createSession: (overrides: SubagentSessionOverrides) => Promise<AgentRuntimeSession>
  /** The parent's transcript so far, including the running turn. */
  parentTranscript: () => readonly TranscriptEntry[]
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

const parameters = Type.Object({
  description: Type.String({ description: 'A short (3-5 word) title of the task, shown to the user.' }),
  prompt: Type.String({ description: 'The task for the subagent.' }),
  fork: Type.Optional(
    Type.Boolean({
      description: 'Start from this conversation as it is now instead of an empty context. Default false.'
    })
  )
})

const text = (value: string) => ({ type: 'text' as const, text: value })
const taskText = (prompt: string) => `${PREAMBLE}\n\nTask:\n${prompt}`

/** Pi accepts session ids of letters, digits and `._-` that start and end with a letter or digit. */
const subagentSessionId = (parentSessionId: string, toolCallId: string) =>
  `${parentSessionId}.${toolCallId.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '') || 'call'}`

const zeroUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
})

function addUsage(sum: Usage, usage: Usage): Usage {
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

/** Runs the task to settlement; the result carries the subagent's final message and the sum of its usage. */
async function run(
  child: AgentRuntimeSession,
  prompt: string,
  base: Omit<SubagentDetails, 'outcome'>
): Promise<AgentToolResult<SubagentDetails>> {
  const { session } = child
  // Not read from `session.messages`: Pi swaps it for the compacted context, dropping folded replies.
  const replies: AssistantMessage[] = []
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'assistant') replies.push(event.message)
  })
  let error: string | undefined
  try {
    await session.prompt(taskText(prompt), { expandPromptTemplates: false, source: 'extension' })
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
  } finally {
    unsubscribe()
  }
  const usage = replies.reduce((sum, reply) => addUsage(sum, reply.usage), zeroUsage())
  const last = replies.at(-1)
  if (error === undefined && last?.stopReason === 'stop') {
    const finalText = last.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()
    return { content: [text(finalText || NO_FINAL_MESSAGE)], details: { ...base, outcome: 'completed' }, usage }
  }
  return {
    content: [text(`The subagent failed: ${error ?? last?.errorMessage ?? 'it ended without a reply'}`)],
    details: { ...base, outcome: 'failed' },
    usage,
    isError: true
  }
}

/** The `subagent` tool: each call runs a subagent session in-process and returns its final report. */
export function subagentExtension({ port, createSession, parentTranscript }: SubagentToolOptions): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: SUBAGENT_TOOL_NAME,
      label: 'Subagent',
      description: DESCRIPTION,
      parameters,
      exposure: 'model-only',
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        if (isSubagentSession(ctx.sessionManager.getBranch())) throw new Error('Subagents cannot start subagents.')
        const description = params.description.trim()
        const prompt = params.prompt.trim()
        if (!description || !prompt) throw new Error('A subagent needs a non-empty description and prompt.')
        const fork = params.fork ?? false
        const subagent: Subagent = {
          parentToolCallId: toolCallId,
          sessionId: subagentSessionId(ctx.sessionManager.getSessionId(), toolCallId),
          fork
        }
        const options = await port.configure(subagent)
        const transcript = [...(fork ? forkTranscript(parentTranscript(), toolCallId) : []), originEntry(subagent)]
        const child = await createSession({
          sessionId: subagent.sessionId,
          transcript,
          fork,
          extensionFactories: options.extensionFactories ?? [],
          onEvent: options.onEvent
        })
        try {
          options.onSessionCreated?.(child.session)
          return await run(child, prompt, { sessionId: subagent.sessionId, fork })
        } finally {
          await child.dispose()
        }
      }
    })
  }
}
