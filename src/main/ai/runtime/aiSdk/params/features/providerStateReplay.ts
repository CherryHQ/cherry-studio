import type { LanguageModelV3Message, LanguageModelV3StreamPart, SharedV3ProviderMetadata } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

type AssistantPart = Extract<LanguageModelV3Message, { role: 'assistant' }>['content'][number]

interface ProviderStateReplay {
  routeId: string
  hasState: (metadata: SharedV3ProviderMetadata | undefined) => boolean
  omitState?: (part: Exclude<AssistantPart, { type: 'reasoning' }>) => AssistantPart
  isLegacyForeign?: (part: AssistantPart) => boolean
}

export function createProviderStateReplayMiddleware({
  routeId,
  hasState,
  omitState,
  isLegacyForeign
}: ProviderStateReplay): LanguageModelMiddleware {
  const stamp = <T extends { providerMetadata?: SharedV3ProviderMetadata }>(part: T): T => {
    const metadata = part.providerMetadata
    if (!hasState(metadata)) return part
    return { ...part, providerMetadata: { ...metadata, cherry: { ...metadata?.cherry, replayRouteId: routeId } } }
  }

  return {
    specificationVersion: 'v3',
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()
      return { ...result, content: result.content.map((part) => ('providerMetadata' in part ? stamp(part) : part)) }
    },
    wrapStream: async ({ doStream }) => {
      const result = await doStream()
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            transform(part, controller) {
              controller.enqueue(part.type !== 'finish' && 'providerMetadata' in part ? stamp(part) : part)
            }
          })
        )
      }
    },
    transformParams: async ({ params }) => {
      const currentTurn = params.prompt.findLastIndex(
        (message) => message.role === 'user' && message.content.some((part) => part.type !== 'text' || part.text.trim())
      )
      if (currentTurn < 0) return params
      const prompt = params.prompt.map((message, index) => {
        if (index >= currentTurn || message.role !== 'assistant') return message
        const content = message.content.flatMap((part) => {
          const source = part.providerOptions?.cherry?.replayRouteId
          const foreign = typeof source === 'string' ? source !== routeId : isLegacyForeign?.(part)
          if (!foreign) return [part]
          if (part.type === 'reasoning') return []
          return [omitState && hasState(part.providerOptions) ? omitState(part) : part]
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
