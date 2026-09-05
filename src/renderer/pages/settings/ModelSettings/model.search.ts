import type { SettingsSearchEntry } from '../settingsSearch/types'

// Indexed rows = statically visible actionable rows (D8). Retry sub-rows and
// the quick-model/translate drawers (PageSidePanel) stay out — conditional or
// drawer-anchored. The compact variant (onboarding) renders without ids, so
// ids never duplicate across the two mount shapes.
export const route = '/settings/model'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'default-assistant-model',
    titleKey: 'settings.models.default_assistant_model',
    groupKey: 'settings.model',
    descriptionKey: 'settings.models.default_assistant_model_description'
  },
  {
    anchorId: 'conversation-suggestions',
    titleKey: 'settings.models.conversation_suggestions.label',
    groupKey: 'settings.model',
    descriptionKey: 'settings.models.conversation_suggestions.description'
  },
  {
    anchorId: 'quick-model',
    titleKey: 'settings.models.quick_model.label',
    groupKey: 'settings.model',
    descriptionKey: 'settings.models.quick_model.description'
  },
  {
    anchorId: 'translate-model',
    titleKey: 'settings.models.translate_model',
    groupKey: 'settings.model',
    descriptionKey: 'settings.models.translate_model_description'
  },
  {
    anchorId: 'painting-model',
    titleKey: 'settings.models.painting_model',
    groupKey: 'settings.model',
    descriptionKey: 'settings.models.painting_model_description'
  },
  {
    anchorId: 'retry-enabled',
    titleKey: 'settings.models.retry.label',
    groupKey: 'settings.model',
    descriptionKey: 'settings.models.retry.description',
    aliases: ['retry', '重试']
  }
]
