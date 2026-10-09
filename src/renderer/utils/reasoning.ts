import type { TFunction } from 'i18next'

import type { ThinkingOption } from '@renderer/types/reasoning'

const EFFORT_LABEL_KEYS: Record<ThinkingOption, string> = {
  default: 'assistants.settings.reasoning_effort.default',
  none: 'assistants.settings.reasoning_effort.off',
  minimal: 'assistants.settings.reasoning_effort.minimal',
  low: 'assistants.settings.reasoning_effort.low',
  medium: 'assistants.settings.reasoning_effort.medium',
  high: 'assistants.settings.reasoning_effort.high',
  xhigh: 'assistants.settings.reasoning_effort.xhigh',
  max: 'assistants.settings.reasoning_effort.max',
  ultra: 'assistants.settings.reasoning_effort.ultra',
  auto: 'assistants.settings.reasoning_effort.auto'
}

export function reasoningEffortLabel(value: string, t: TFunction, nativeName?: string) {
  if (Object.hasOwn(EFFORT_LABEL_KEYS, value)) return t(EFFORT_LABEL_KEYS[value as ThinkingOption])
  if (value === 'off') return t('assistants.settings.reasoning_effort.off')
  const name = nativeName ?? value
  return name === 'On (default)' ? t('local_agents.thinking_on_default') : name
}
