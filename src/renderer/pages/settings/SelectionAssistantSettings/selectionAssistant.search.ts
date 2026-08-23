import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/selection-assistant'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'enable-selection-assistant',
    titleKey: 'selection.settings.enable.title',
    groupKey: 'selection.name',
    aliases: ['selection assistant', '划词']
  }
  // rows behind the selectionEnabled master switch (filter mode/list, off by
  // default) stay out per D8 — their anchors may not exist on jump
]
