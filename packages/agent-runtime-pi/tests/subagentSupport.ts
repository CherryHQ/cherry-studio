import type { AssistantMessage, JsonObject, ToolCall } from '@earendil-works/pi-ai'

import type { ModelCall } from './sessionSupport'
import { assistantReply, messageText, respondingModel } from './sessionSupport'

export interface RoutedCall {
  /** Role of the last prompt message: `user` on a new request, `tool` after tool results. */
  lastRole: string
  /** Text of every user message in the prompt, joined. */
  userText: string
  /** Text of the last prompt message when it is a user message (a prompt or a notification). */
  lastText: string
  options: ModelCall
}

/** A final reply; `input` is its uncached input tokens (2 more are cached), `output` its output tokens. */
export const reply = (text: string, input = 10, output = 5): AssistantMessage =>
  assistantReply([{ type: 'text', text: text }], 'stop', input, output)

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
