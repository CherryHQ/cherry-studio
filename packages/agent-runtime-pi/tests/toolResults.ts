import type { Message, ToolResultMessage } from '@earendil-works/pi-ai'
import type { AgentSession } from '@earendil-works/pi-coding-agent'

export const toolResults = (session: AgentSession) =>
  session.messages.filter((message): message is ToolResultMessage => message.role === 'toolResult')

export const textOf = (result: ToolResultMessage) =>
  result.content.map((part) => (part.type === 'text' ? part.text : '')).join('')

/** Tool outputs the model was sent, by tool call id. */
export const toolOutputs = (prompt: Message[]) =>
  Object.fromEntries(
    prompt
      .filter((message): message is ToolResultMessage => message.role === 'toolResult')
      .map((message) => [message.toolCallId, textOf(message)])
  )
