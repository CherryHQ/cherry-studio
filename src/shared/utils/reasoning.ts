import type { ReasoningEffortOption } from '@shared/types/aiSdk'

/** Selectable reasoning-effort values — a model's registry vocabulary
 * (`REASONING_EFFORT`) plus the `'default'` sentinel. Semantics:
 * - 'none': Disable reasoning; also "off" for on/off-only (toggle) models.
 * - 'minimal'…'high': Effort ladder (OpenAI vocabulary).
 * - 'xhigh': OpenAI GPT-5.x native top tier.
 * - 'max': Anthropic 4.6+ / DeepSeek V4 native top tier.
 * - 'auto': Model decides; also "on" for toggle-only models.
 * - 'default': Send no reasoning-related params at all.
 */
export type { ReasoningEffortOption }

export type EffortRatio = Record<ReasoningEffortOption, number>

export const EFFORT_RATIO: EffortRatio = {
  // 'default' is not expected to be used.
  default: 0,
  none: 0.01,
  minimal: 0.05,
  low: 0.05,
  medium: 0.5,
  high: 0.8,
  xhigh: 0.9,
  max: 1,
  auto: 2
}
