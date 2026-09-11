import type { SettingsSearchEntry } from '../settingsSearch/types'

// Indexed rows = statically visible actionable rows (D8). The quick-model and
// translate drawers (PageSidePanel) stay out because they are drawer-anchored.
// The compact variant (onboarding) renders without ids, so ids never duplicate
// across the two mount shapes.
export const route = '/settings/model'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'default-assistant-model',
    titleKey: 'settings.models.default_assistant_model',
    groupKey: 'settings.model',
    descriptionKey: 'settings.models.default_assistant_model_description'
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
  }
]
