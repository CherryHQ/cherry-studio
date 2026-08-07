import type { Model } from '@shared/data/types/model'
import type { LanguageModelUsage } from 'ai'

import type { AgentLoopHooks } from '../runtime/aiSdk'
import { mergeUsage, ZERO_USAGE } from '../runtime/aiSdk'

/** Reports token usage to telemetry. A subset of `LanguageModelUsage`. */
export type TrackUsage = (model: Model, usage: { inputTokens?: number; outputTokens?: number }) => void

/**
 * Telemetry funnel — accumulates per-step usage and reports the total via the
 * injected `trackUsage` (backed by `AnalyticsService`). Deliberately separate
 * from the billing hook; `trackUsage` is passed in because it is also used by
 * the non-streaming (embedding) paths on the service.
 */
export function createAnalyticsHook(model: Model, trackUsage: TrackUsage): Partial<AgentLoopHooks> {
  let total: LanguageModelUsage = ZERO_USAGE
  let flushed = false
  const flush = () => {
    if (flushed) return
    flushed = true
    trackUsage(model, total)
  }

  return {
    onStepFinish: (step) => {
      if (step.usage) total = mergeUsage(total, step.usage)
    },
    onFinish: flush,
    onAbort: flush,
    onError: () => {
      flush()
      return 'abort'
    }
  }
}
