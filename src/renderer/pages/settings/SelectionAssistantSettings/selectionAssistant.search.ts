import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/selection-assistant'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'enable-selection-assistant',
    titleKey: 'selection.settings.enable.title',
    groupKey: 'selection.name',
    aliases: ['selection assistant', '划词']
  },
  {
    anchorId: 'filter-mode',
    titleKey: 'selection.settings.advanced.filter_mode.title',
    groupKey: 'selection.settings.advanced.title'
  },
  {
    anchorId: 'filter-list',
    titleKey: 'selection.settings.advanced.filter_list.title',
    groupKey: 'selection.settings.advanced.title'
  }
]
