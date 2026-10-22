import type { AssistantMessage, JsonObject, Message, ToolCall } from '@earendil-works/pi-ai'
import { type ToolResultMessage, Type } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { type AgentSession, defineTool, type ExtensionFactory, SessionManager } from '@earendil-works/pi-coding-agent'

import {
  type AgentRuntimeEvent,
  type Subagent,
  SUBAGENT_STATE_TYPE,
  type SubagentPort,
  type SubagentSessionOptions,
  type SubagentState,
  type SubagentView
} from '../src'
import type { ModelCall } from './sessionSupport'
import { messageText, respondingModel } from './sessionSupport'
import { assistantReply } from './sessionSupport'

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
  options: ModelCall
}

/** The first line of every notification the parent's model gets. */
export const NOTE = 'Background subagent update (automatic message, not from the user):'

/** A final reply; `input` is its uncached input tokens (2 more are cached), `output` its output tokens. */
export const reply = (text: string, input = 10, output = 5): AssistantMessage =>
  assistantReply([{ type: 'text', text: text }], 'stop', input, output)

function humanTextOf(prompt: Message[]): string {
  const trailing: string[] = []
  for (let i = prompt.length - 1; i >= 0 && prompt[i].role === 'user'; i--) trailing.unshift(userTextOf(prompt[i]))
  return trailing.find((text) => !text.startsWith(NOTE)) ?? ''
}

const userTextOf = (message: Message) => (message.role === 'user' ? messageText(message) : '')

/**
 * A mock that answers each call with the script `route` picks for it, so a parent and its
 * subagents can share one model (and one port) the way they do in production. A route may wait
 * (on a {@link gate}) before it answers; an abort still ends the request.
 */
export function routedModel(route: (call: RoutedCall) => AssistantMessage | Promise<AssistantMessage>) {
  const calls: RoutedCall[] = []
  const native = respondingModel(async (options) => {
    const last = options.messages.at(-1)
    const call: RoutedCall = {
      lastRole: last?.role ?? '',
      userText: options.messages
        .filter((message) => message.role === 'user')
        .map(messageText)
        .join('\n'),
      lastText: last?.role === 'user' ? messageText(last) : '',
      humanText: humanTextOf(options.messages),
      options
    }
    calls.push(call)
    return route(call)
  })
  return { model: native.model, calls, requests: native.calls }
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

export const toolCallPart = (toolCallId: string, toolName: string, input: JsonObject = {}): ToolCall => ({
  type: 'toolCall',
  id: toolCallId,
  name: toolName,
  arguments: input
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

/** Native branch snapshots for crash fixtures; persistent managers reopen their own files. */
export function storingSubagentPort(
  extra: (subagent: Subagent) => SubagentSessionOptions | Promise<SubagentSessionOptions> = () => ({})
) {
  const recording = recordingSubagentPort(extra)
  const branches = new Map<string, SessionEntry[]>()
  const port: SubagentPort = {
    async configure(subagent) {
      const options = await recording.port.configure(subagent)
      const stored = branches.get(subagent.sessionId) ?? []
      branches.set(subagent.sessionId, stored)
      let manager: SessionManager | undefined
      const snapshot = () => {
        if (manager) stored.splice(0, stored.length, ...JSON.parse(JSON.stringify(manager.getBranch())))
      }
      return {
        ...options,
        onSessionCreated(session) {
          manager = session.sessionManager
          snapshot()
          options.onSessionCreated?.(session)
        },
        onEvent(event) {
          snapshot()
          options.onEvent?.(event)
        }
      }
    },
    async load(id) {
      const entries = branches.get(id)
      const manager = recording.sessions.get(id)?.sessionManager
      if (!entries || !manager) return undefined
      return manager.isPersisted()
        ? SessionManager.open(manager.getSessionFile()!)
        : SessionManager.inMemory(manager.getCwd(), { id }, entries)
    }
  }
  return { ...recording, port, branches }
}

/** Tool results in a call's prompt, in order. */
export function toolResults(call: RoutedCall) {
  return call.options.messages.filter((message): message is ToolResultMessage => message.role === 'toolResult')
}

export const outputText = (content: ToolResultMessage['content']) =>
  content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')

/** The latest result Pi recorded for a tool call in a session (providers may reuse call ids). */
export function toolResultOf(session: AgentSession, toolCallId: string): ToolResultMessage {
  const result = session.messages.findLast(
    (message): message is ToolResultMessage => message.role === 'toolResult' && message.toolCallId === toolCallId
  )
  if (!result) throw new Error(`no result for ${toolCallId}`)
  return result
}

const untilAborted = (signal: AbortSignal | undefined) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) resolve()
    else signal?.addEventListener('abort', () => resolve(), { once: true })
  })

/**
 * `stop_turn`: does to `parent.session`'s turn what the user's stop button does, then returns once
 * its own call is aborted. `before` runs first.
 */
export function stopTurnTool(parent: { session?: AgentSession }, before?: () => Promise<unknown>) {
  return defineTool({
    name: 'stop_turn',
    label: 'Stop turn',
    description: 'The user presses stop',
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      await before?.()
      void parent.session!.abort()
      await untilAborted(signal)
      return { content: [{ type: 'text', text: 'stopped' }], details: undefined }
    }
  })
}

/** `work`: a subagent tool that runs until its run is stopped; `reached` resolves once it runs. */
export function untilStopped() {
  const started = gate()
  const tool = defineTool({
    name: 'work',
    label: 'Work',
    description: 'Works until stopped',
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      void started.wait(undefined)
      await untilAborted(signal)
      return { content: [{ type: 'text', text: 'stopped working' }], details: undefined }
    }
  })
  return { tool, reached: started.reached }
}

/** `/round`: a command that starts a turn of its own with a `ROUND` message, as `/goal resume` does. */
export const roundCommand: ExtensionFactory = (pi) => {
  pi.registerCommand('round', {
    description: 'Starts a turn of its own',
    handler: async () => {
      pi.sendMessage({ customType: 'test.round', content: 'ROUND', display: false }, { triggerTurn: true })
    }
  })
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
export const subagentStates = (entries: readonly SessionEntry[]): SubagentState[] =>
  entries.flatMap((entry) =>
    entry.type === 'custom' && entry.customType === SUBAGENT_STATE_TYPE ? [entry.data as SubagentState] : []
  )

/** The lists the parent's `subagents` events carried, in order. */
export const subagentViews = (events: readonly AgentRuntimeEvent[]): SubagentView[][] =>
  events.flatMap((event) => (event.type === 'subagents' ? [event.subagents] : []))

/** Resolves once every background subagent the parent's events list has finished and the parent is idle. */
export async function subagentsDone(session: AgentSession, events: readonly AgentRuntimeEvent[]): Promise<void> {
  await waitFor(
    () =>
      subagentViews(events)
        .at(-1)
        ?.every((view) => view.status === 'finished') ?? false
  )
  await session.waitForIdle()
}
