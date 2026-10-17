import type { SettingsSearchEntry } from './settingsSearch/types'

export const route = '/settings/quick-assistant'

const group = 'settings.quickAssistant.title'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'enable-quick-assistant',
    titleKey: 'settings.quickAssistant.enable_quick_assistant',
    groupKey: group,
    aliases: ['quick assistant']
  }
  // feature-gated rows (clipboard, usage method behind the master switch,
  // off by default) stay out per D8 — their anchors may not exist on jump
]
