import { AlwaysOnSampler, ParentBasedSampler, type Sampler, SamplingDecision } from '@opentelemetry/sdk-trace-base'

import { areDiagnosticsSuppressed } from '@main/core/logger/diagnosticScope'

const defaultSampler = new ParentBasedSampler({ root: new AlwaysOnSampler() })

export const diagnosticSampler: Sampler = {
  shouldSample(...args) {
    return areDiagnosticsSuppressed() ? { decision: SamplingDecision.NOT_RECORD } : defaultSampler.shouldSample(...args)
  },
  toString: () => 'DiagnosticScopeSampler'
}
