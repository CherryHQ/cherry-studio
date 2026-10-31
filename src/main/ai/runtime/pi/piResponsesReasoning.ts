import type { ProviderConfig } from '@earendil-works/pi-coding-agent'

import type { loadPiOpenAiResponsesApi } from './piSdk'

type PiStreamSimple = NonNullable<ProviderConfig['streamSimple']>
type PiResponsesStreamSimple = Awaited<ReturnType<typeof loadPiOpenAiResponsesApi>>['streamSimple']

export function withoutReasoningSummary(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'reasoning' in payload) {
    const reasoning = payload.reasoning
    if (reasoning && typeof reasoning === 'object' && Object.hasOwn(reasoning, 'summary')) {
      delete (reasoning as Record<string, unknown>).summary
    }
  }
  return payload
}

export function withReasoningSummarySuppressed(
  config: ProviderConfig,
  apiStreamSimple: PiResponsesStreamSimple
): ProviderConfig {
  const streamSimple: PiStreamSimple = (model, context, options) =>
    apiStreamSimple(model as Parameters<PiResponsesStreamSimple>[0], context, {
      ...options,
      onPayload: async (payload, payloadModel) => {
        const next = await options?.onPayload?.(payload, payloadModel)
        return withoutReasoningSummary(next === undefined ? payload : next)
      }
    })
  return { ...config, streamSimple }
}
