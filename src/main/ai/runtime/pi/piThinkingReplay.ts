import type { ProviderConfig } from '@earendil-works/pi-coding-agent'

import type { loadPiAnthropicMessagesApi } from './piSdk'

type PiStreamSimple = NonNullable<ProviderConfig['streamSimple']>
type PiContext = Parameters<PiStreamSimple>[1]
type PiAnthropicStreamSimple = Awaited<ReturnType<typeof loadPiAnthropicMessagesApi>>['streamSimple']

export function normalizeCherryInThinkingReplay(context: PiContext): PiContext {
  let changed = false
  const messages = context.messages.map((message) => {
    if (message.role !== 'assistant') return message
    const hasToolCall = message.content.some((block) => block.type === 'toolCall')
    const hasThinking = message.content.some((block) => block.type === 'thinking')
    if (!hasToolCall || hasThinking) return message

    changed = true
    // CherryIN uses `msg_<uuid>` when it omits the thinking delta; signed
    // thinking responses expose the same identifier as the bare UUID.
    const signature = message.responseId?.trim().replace(/^msg_/, '') ?? ''
    return {
      ...message,
      content: [
        {
          type: 'thinking' as const,
          // pi-ai's history transform drops empty thinking before serialization.
          thinking: '\u200B',
          thinkingSignature: signature
        },
        ...message.content
      ]
    }
  })
  return changed ? { ...context, messages } : context
}

export function withCherryInThinkingReplay(
  config: ProviderConfig,
  apiStreamSimple: PiAnthropicStreamSimple
): ProviderConfig {
  const streamSimple: PiStreamSimple = (model, context, options) =>
    apiStreamSimple(model as Parameters<PiAnthropicStreamSimple>[0], normalizeCherryInThinkingReplay(context), options)
  return { ...config, streamSimple }
}
