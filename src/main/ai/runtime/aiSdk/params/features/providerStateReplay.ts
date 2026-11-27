import type { LanguageModelV3Message, LanguageModelV3StreamPart, SharedV3ProviderMetadata } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

import { isReplayUserMessage } from '../../../../provider/replayRoute'

export type AssistantPart = Extract<LanguageModelV3Message, { role: 'assistant' }>['content'][number]

interface ProviderStateReplay {
  routeId: string
  hasState: (metadata: SharedV3ProviderMetadata | undefined) => boolean
  omitState?: (part: Exclude<AssistantPart, { type: 'reasoning' }>) => AssistantPart
  isLegacyForeign?: (part: AssistantPart) => boolean
  capturePlainReasoning?: boolean
  requirePlainReasoning?: boolean
  responsesOptionsKey?: string
  filterCurrentTurn?: boolean
}

export function createProviderStateReplayMiddleware({
  routeId,
  hasState,
  omitState,
  isLegacyForeign,
  capturePlainReasoning,
  requirePlainReasoning,
  responsesOptionsKey,
  filterCurrentTurn
}: ProviderStateReplay): LanguageModelMiddleware {
  const stamp = <T extends { type: string }>(part: T, store?: boolean): T => {
    const metadata = 'providerMetadata' in part ? (part.providerMetadata as SharedV3ProviderMetadata) : undefined
    const bound = hasState(metadata)
    if (!bound && !(capturePlainReasoning && (part.type === 'reasoning' || part.type === 'reasoning-start')))
      return part
    return {
      ...part,
      providerMetadata: {
        ...metadata,
        cherry: {
          ...metadata?.cherry,
          replayRouteId: routeId,
          replayRequiresRoute: bound || requirePlainReasoning === true,
          ...(store !== undefined && { responsesStore: store })
        }
      }
    }
  }

  return {
    specificationVersion: 'v3',
    wrapGenerate: async ({ doGenerate, params }) => {
      const result = await doGenerate()
      const store = responsesOptionsKey ? params.providerOptions?.[responsesOptionsKey]?.store !== false : undefined
      return { ...result, content: result.content.map((part) => stamp(part, store)) }
    },
    wrapStream: async ({ doStream, params }) => {
      const result = await doStream()
      const store = responsesOptionsKey ? params.providerOptions?.[responsesOptionsKey]?.store !== false : undefined
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            transform(part, controller) {
              controller.enqueue(part.type === 'finish' ? part : stamp(part, store))
            }
          })
        )
      }
    },
    transformParams: async ({ params }) => {
      const currentTurn = params.prompt.findLastIndex(
        (message) =>
          isReplayUserMessage(message) && message.content.some((part) => part.type !== 'text' || part.text.trim())
      )
      if (currentTurn < 0 && !filterCurrentTurn) return params
      const prompt = params.prompt.map((message, index) => {
        if (message.role !== 'assistant' || (!filterCurrentTurn && index >= currentTurn)) return message
        const content = message.content.flatMap((part) => {
          const source = part.providerOptions?.cherry?.replayRouteId
          const foreign = typeof source === 'string' ? source !== routeId : isLegacyForeign?.(part)
          const unaddressable =
            responsesOptionsKey &&
            part.providerOptions?.cherry?.responsesStore === false &&
            params.providerOptions?.[responsesOptionsKey]?.store !== false
          if (!foreign && !unaddressable) return [part]
          if (part.type === 'reasoning') return []
          if (part.type === 'text' && !part.text.trim()) return []
          return [omitState?.(part) ?? part]
        })
        // Preserve a valid assistant turn when its only content was opaque state.
        return content.length
          ? { ...message, content }
          : { ...message, content: [{ type: 'text' as const, text: '...' }] }
      })
      return { ...params, prompt }
    }
  }
}
