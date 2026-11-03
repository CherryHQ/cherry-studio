import type { AnthropicMessagesCompat } from '@earendil-works/pi-ai'
import type { ProviderConfig } from '@earendil-works/pi-coding-agent'
import { get, set, unset } from 'es-toolkit/compat'

import type { ReasoningWireDialect, ReasoningWireTarget, ReasoningWireValue } from '@cherrystudio/provider-registry'
import type { ResolvedReasoningProfile } from '@data/services/ProviderRegistryService'
import { encodeReasoningInvocation, type ResolvedReasoningInvocation } from '@main/ai/utils/reasoningSerializers'

type PiReasoningCompatPatch = Pick<AnthropicMessagesCompat, 'forceAdaptiveThinking'>

type ReasoningCompatRow = {
  expectedWire: {
    mode: 'default' | 'off' | 'auto' | 'effort'
    target: ReasoningWireTarget
    literal: Extract<ReasoningWireValue, { source: 'literal' }>['value']
  }
  compat: PiReasoningCompatPatch
}

const DIALECT_COMPAT: Record<ReasoningWireDialect, ReasoningCompatRow | null> = {
  effort: null,
  budget: null,
  'adaptive-always': {
    expectedWire: { mode: 'effort', target: 'thinking.type', literal: 'adaptive' },
    compat: { forceAdaptiveThinking: true }
  },
  'adaptive-between-tools': null
}

/**
 * Project the Pi Anthropic compatibility a model's declared reasoning wire dialect requires.
 * A row applies only while the resolved wire still writes the shape it declares, so an explicit
 * endpoint wire or per-model reasoning contract keeps precedence over the dialect default.
 */
export function projectPiReasoningCompat(
  profile: Pick<ResolvedReasoningProfile, 'wireDialect' | 'wire'> | undefined
): PiReasoningCompatPatch {
  if (!profile || profile.wireDialect === undefined || profile.wire.disabled === true) return {}

  const row = DIALECT_COMPAT[profile.wireDialect]
  if (!row) return {}

  const operation = profile.wire[row.expectedWire.mode]?.operations.findLast(
    (candidate) => candidate.target === row.expectedWire.target
  )

  return operation?.value.source === 'literal' && operation.value.value === row.expectedWire.literal ? row.compat : {}
}

type PiStreamSimple = NonNullable<ProviderConfig['streamSimple']>

// Inverse of options.ts normalizeOpenAICompatibleParams: Pi's callback sees HTTP field names.
function toPayloadTarget(target: ReasoningWireTarget): ReasoningWireTarget {
  return target === 'reasoningEffort' ? 'reasoning_effort' : target
}

export function withPiReasoningOff(
  streamSimple: PiStreamSimple,
  invocation: ResolvedReasoningInvocation & Pick<ResolvedReasoningProfile, 'wire'>
): PiStreamSimple {
  const emissions = invocation.emissions.map((emission) => ({ ...emission, target: toPayloadTarget(emission.target) }))
  const encoded = encodeReasoningInvocation({ ...invocation, emissions })
  const emittedTargets = new Set(emissions.map((emission) => emission.target))
  const competingTargets = new Set(
    [invocation.wire.auto, invocation.wire.effort, invocation.wire.default].flatMap((mode) =>
      (mode?.operations ?? []).map((operation) => toPayloadTarget(operation.target))
    )
  )
  for (const target of emittedTargets) competingTargets.delete(target)

  return (model, context, options) =>
    streamSimple(model, context, {
      ...options,
      onPayload: async (payload, payloadModel) => {
        const replacement = await options?.onPayload?.(payload, payloadModel)
        const result = replacement === undefined ? payload : replacement
        if (!result || typeof result !== 'object') return result
        for (const target of competingTargets) unset(result, target)
        for (const target of emittedTargets) {
          const value = get(encoded, target)
          if (get(result, target) !== value) set(result, target, value)
        }
        return result
      }
    })
}
