import type { SettingsSearchEntry } from './settingsSearch/types'

export const route = '/settings/labs'
export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'interface-mode',
    titleKey: 'settings.labs.mode',
    descriptionKey: 'settings.labs.description',
    aliases: ['极简模式', '效率模式', 'minimal', 'efficiency']
  }
]
