import type { LanguageModelV3CallOptions, LanguageModelV3Message, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type, type ToolResultMessage } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import {
  type AgentRuntimeEvent,
  type Subagent,
  SUBAGENT_STATE_TYPE,
  type SubagentPort,
  type SubagentSessionOptions,
  type SubagentState,
  type SubagentView,
  type TranscriptEntry
} from '../src'

export interface RoutedCall {
  /** Role of the last prompt message: `user` on a new request, `tool` after tool results. */
  lastRole: string
  /** Text of every user message in the prompt, joined. */
  userText: string
  /** Text of the last prompt message when it is a user message (a prompt or a notification). */
  lastText: string
  /**
   * Text of the person's message that starts this request, also when a notification rides after it;
   * '' for a request after tool results or one a notification starts.
   */
  humanText: string
  options: LanguageModelV3CallOptions
}

const NOTIFICATION_HEAD = 'Background subagent update'

function humanTextOf(prompt: LanguageModelV3Message[]): string {
  const trailing: string[] = []
  for (let i = prompt.length - 1; i >= 0 && prompt[i].role === 'user'; i--) trailing.unshift(userTextOf(prompt[i]))
  return trailing.find((text) => !text.startsWith(NOTIFICATION_HEAD)) ?? ''
}

const userTextOf = (message: LanguageModelV3Message) =>
  message.role === 'user' ? message.content.map((part) => (part.type === 'text' ? part.text : '')).join('') : ''

/**
 * A mock that answers each call with the script `route` picks for it, so a parent and its
 * subagents can share one model (and one port) the way they do in production. A route may wait
 * (on a {@link gate}) before it answers; an abort still ends the request.
 */
export function routedModel(
  route: (call: RoutedCall) => LanguageModelV3StreamPart[] | Promise<LanguageModelV3StreamPart[]>
) {
  const calls: RoutedCall[] = []
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      const last = options.prompt.at(-1)
      const call: RoutedCall = {
        lastRole: last?.role ?? '',
        userText: options.prompt.map(userTextOf).join('\n'),
        lastText: last ? userTextOf(last) : '',
        humanText: humanTextOf(options.prompt),
        options
      }
      calls.push(call)
      return { stream: simulateReadableStream({ chunks: await route(call) }) }
    }
  })
  return { model, calls }
}

/** Holds the requests that `wait()` on it until `open()`; `reached` resolves once one waits. */
export function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  let arrive!: () => void
  const reached = new Promise<void>((resolve) => (arrive = resolve))
  return {
    open,
    reached,
    wait: <T>(value: T): Promise<T> => {
      arrive()
      return opened.then(() => value)
    }
  }
}

/** Resolves once `check()` holds, polling; fails after `timeoutMs`. */
export async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

export const toolCallPart = (toolCallId: string, toolName: string, input: object = {}): LanguageModelV3StreamPart => ({
  type: 'tool-call',
  toolCallId,
  toolName,
  input: JSON.stringify(input)
})

export const subagentCall = (
  toolCallId: string,
  input: { description: string; prompt: string; fork?: boolean; background?: boolean }
) => toolCallPart(toolCallId, 'subagent', input)

/** A host port that records each subagent it configures and the events and session that subagent gets. */
export function recordingSubagentPort(
  extra: (subagent: Subagent) => SubagentSessionOptions | Promise<SubagentSessionOptions> = () => ({})
) {
  const subagents: Subagent[] = []
  const events = new Map<string, AgentRuntimeEvent[]>()
  const sessions = new Map<string, AgentSession>()
  const port: SubagentPort = {
    async configure(subagent) {
      subagents.push(subagent)
      const received: AgentRuntimeEvent[] = []
      events.set(subagent.sessionId, received)
      const options = await extra(subagent)
      return {
        ...options,
        onEvent: (event) => received.push(event),
        onSessionCreated: (session) => {
          sessions.set(subagent.sessionId, session)
          options.onSessionCreated?.(session)
        }
      }
    }
  }
  return { port, subagents, events, sessions }
}

/**
 * A host port that also stores every subagent's transcript, as the host persists it (JSON copies,
 * appended per `sessionId` across runs), and loads it back to continue the subagent.
 */
export function storingSubagentPort(
  extra: (subagent: Subagent) => SubagentSessionOptions | Promise<SubagentSessionOptions> = () => ({})
) {
  const recording = recordingSubagentPort(extra)
  const transcripts = new Map<string, TranscriptEntry[]>()
  const port: SubagentPort = {
    async configure(subagent) {
      const options = await recording.port.configure(subagent)
      const stored = transcripts.get(subagent.sessionId) ?? []
      transcripts.set(subagent.sessionId, stored)
      return {
        ...options,
        onEvent: (event) => {
          if (event.type === 'transcript-append') stored.push(...JSON.parse(JSON.stringify(event.entries)))
          options.onEvent?.(event)
        }
      }
    },
    load: async (sessionId) => transcripts.get(sessionId)
  }
  return { ...recording, port, transcripts }
}

/** Tool results in a call's prompt, in order. */
export function toolResults(call: RoutedCall) {
  return call.options.prompt
    .flatMap((message) => (message.role === 'tool' ? message.content : []))
    .flatMap((part) => (part.type === 'tool-result' ? [part] : []))
}

/** The text the model saw for a tool result output. */
export function outputText(output: unknown): string {
  const value = (output as { value?: unknown }).value
  return typeof value === 'string' ? value : JSON.stringify(output)
}

/** The latest result Pi recorded for a tool call in a session (providers may reuse call ids). */
export function toolResultOf(session: AgentSession, toolCallId: string): ToolResultMessage {
  const result = session.messages.findLast(
    (message): message is ToolResultMessage => message.role === 'toolResult' && message.toolCallId === toolCallId
  )
  if (!result) throw new Error(`no result for ${toolCallId}`)
  return result
}

export const noteTool = defineTool({
  name: 'note',
  label: 'Note',
  description: 'Write a note',
  parameters: Type.Object({}),
  async execute() {
    return { content: [{ type: 'text', text: 'noted' }], details: undefined }
  }
})

/** Every `cherry.subagent-state` snapshot in the parent's transcript, in order. */
export const subagentStates = (entries: readonly TranscriptEntry[]): SubagentState[] =>
  entries.flatMap((entry) =>
    entry.kind === 'state' && entry.type === SUBAGENT_STATE_TYPE ? [entry.data as unknown as SubagentState] : []
  )

/** The lists the parent's `subagents` events carried, in order. */
export const subagentViews = (events: readonly AgentRuntimeEvent[]): SubagentView[][] =>
  events.flatMap((event) => (event.type === 'subagents' ? [event.subagents] : []))
