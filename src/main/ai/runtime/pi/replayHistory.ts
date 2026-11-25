import type { Api, AssistantMessage, Model, TranscriptContext } from '@earendil-works/pi-ai'

import { ToolContinuationRouteError } from '../../provider/replayRoute'

export type ReplayAssistantMessage = AssistantMessage & {
  cherryReplayRouteId?: string
  cherryRequiresToolReasoning?: boolean
}

export function getPendingPiReplayMessage(context: TranscriptContext): ReplayAssistantMessage | undefined {
  const active = context.messages.slice(context.messages.findLastIndex((message) => message.role === 'user') + 1)
  const results = new Set(active.flatMap((message) => (message.role === 'toolResult' ? [message.toolCallId] : [])))
  let source: ReplayAssistantMessage | undefined
  for (const message of active) {
    if (message.role !== 'assistant') continue
    const tagged = message as ReplayAssistantMessage
    if (
      !tagged.cherryReplayRouteId ||
      !tagged.content.some((part) => part.type === 'toolCall' && results.has(part.id)) ||
      !tagged.content.some((part) =>
        part.type === 'thinking'
          ? part.thinkingSignature || part.redacted || (tagged.cherryRequiresToolReasoning && part.thinking)
          : part.type === 'text'
            ? part.textSignature
            : part.thoughtSignature
      )
    )
      continue
    if (source && source.cherryReplayRouteId !== tagged.cherryReplayRouteId) throw new ToolContinuationRouteError()
    source = tagged
  }
  return source
}

export function getForeignPiToolOrdinals(context: TranscriptContext, routeId: string): ReadonlySet<number> {
  const ordinals = new Set<number>()
  let ordinal = 0
  for (const message of context.messages) {
    if (message.role !== 'assistant' || message.stopReason === 'error' || message.stopReason === 'aborted') continue
    const source = (message as ReplayAssistantMessage).cherryReplayRouteId
    for (const part of message.content) {
      if (part.type !== 'toolCall') continue
      if (source && source !== routeId) ordinals.add(ordinal)
      ordinal++
    }
  }
  return ordinals
}

export function preparePiReplay(context: TranscriptContext, model: Model<Api>, routeId: string): TranscriptContext {
  const messages = context.messages.map((message) => {
    if (message.role !== 'assistant') return message
    const sourceRoute = (message as ReplayAssistantMessage).cherryReplayRouteId
    if (!sourceRoute) return message
    if (sourceRoute === routeId) return { ...message, provider: model.provider, api: model.api, model: model.id }
    // Let the native serializer remove signatures and normalize tool IDs together with their results.
    return { ...message, provider: 'cherry-replay/foreign' }
  })
  return { ...context, messages }
}
