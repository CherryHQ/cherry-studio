import type { LanguageModelV3CallOptions, LanguageModelV3Message, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type, type ToolResultMessage } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool } from '@earendil-works/pi-coding-agent'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import type { AgentRuntimeEvent, Subagent, SubagentPort, SubagentSessionOptions } from '../src'

export interface RoutedCall {
  /** Role of the last prompt message: `user` on a new request, `tool` after tool results. */
  lastRole: string
  /** Text of every user message in the prompt, joined. */
  userText: string
  options: LanguageModelV3CallOptions
}

const userTextOf = (message: LanguageModelV3Message) =>
  message.role === 'user' ? message.content.map((part) => (part.type === 'text' ? part.text : '')).join('') : ''

/**
 * A mock that answers each call with the script `route` picks for it, so a parent and its
 * subagents can share one model (and one port) the way they do in production.
 */
export function routedModel(route: (call: RoutedCall) => LanguageModelV3StreamPart[]) {
  const calls: RoutedCall[] = []
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      const call: RoutedCall = {
        lastRole: options.prompt.at(-1)?.role ?? '',
        userText: options.prompt.map(userTextOf).join('\n'),
        options
      }
      calls.push(call)
      return { stream: simulateReadableStream({ chunks: route(call) }) }
    }
  })
  return { model, calls }
}

export const toolCallPart = (toolCallId: string, toolName: string, input: object = {}): LanguageModelV3StreamPart => ({
  type: 'tool-call',
  toolCallId,
  toolName,
  input: JSON.stringify(input)
})

export const subagentCall = (toolCallId: string, input: { description: string; prompt: string; fork?: boolean }) =>
  toolCallPart(toolCallId, 'subagent', input)

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

/** The result Pi recorded for a tool call in a session. */
export function toolResultOf(session: AgentSession, toolCallId: string): ToolResultMessage {
  const result = session.messages.find(
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
