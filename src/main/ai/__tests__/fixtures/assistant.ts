import type { Assistant, AssistantSettings } from '@shared/data/types/assistant'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

export function makeAssistant(
  overrides: Partial<Omit<Assistant, 'settings'>> & { settings?: Partial<AssistantSettings> } = {}
): Assistant {
  const { settings, ...rest } = overrides
  return {
    settings: { ...DEFAULT_ASSISTANT_SETTINGS, ...settings },
    ...rest
  } as Assistant
}
