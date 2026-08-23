import type { SettingsSearchEntry } from './settingsSearch/types'

export const route = '/settings/quick-assistant'

const group = 'settings.quickAssistant.title'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'enable-quick-assistant',
    titleKey: 'settings.quickAssistant.enable_quick_assistant',
    groupKey: group,
    aliases: ['quick assistant']
  },
  {
    anchorId: 'read-clipboard-at-startup',
    titleKey: 'settings.quickAssistant.read_clipboard_at_startup',
    groupKey: group,
    aliases: ['clipboard', '剪贴板']
  },
  {
    anchorId: 'usage-method',
    titleKey: 'settings.models.quick_assistant_usage_method',
    groupKey: 'settings.models.quick_assistant_response_settings'
  }
]
