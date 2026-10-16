import type { AnthropicMessagesCompat } from '@earendil-works/pi-ai'

import type { ReasoningWireDialect, ReasoningWireTarget, ReasoningWireValue } from '@cherrystudio/provider-registry'
import type { ResolvedReasoningProfile } from '@data/services/ProviderRegistryService'

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
