import type { CompactionSettings } from '@earendil-works/pi-durable'

import { resolveGlobalContextSettings } from '@main/ai/contextBuild/resolveRequestContextSettings'
import { clampThresholdPercent } from '@shared/utils/contextSettings'

import { DEFAULT_AGENT_CONTEXT_WINDOW } from '../agentContextWindow'

/** Map the desktop policy onto native compaction, which runs before each model request. */
export function resolveDurableCompaction(contextWindow: number | undefined): CompactionSettings {
  const settings = resolveGlobalContextSettings()
  if (!settings.enabled || !settings.compress.enabled) return { enabled: false }
  // Match the gateway model's fallback, rather than silently reverting to native defaults.
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0)
    contextWindow = DEFAULT_AGENT_CONTEXT_WINDOW
  const threshold = Math.floor((contextWindow * clampThresholdPercent(settings.compress.thresholdPercent)) / 100)
  return {
    enabled: true,
    reserveTokens: Math.max(0, contextWindow - threshold),
    // Keep native compaction as the only summarizer, with a tail that can fit
    // below the configured trigger even on small-window models.
    keepRecentTokens: Math.min(20_000, Math.floor(threshold * 0.375)),
    backgroundTokens: 0
  }
}
