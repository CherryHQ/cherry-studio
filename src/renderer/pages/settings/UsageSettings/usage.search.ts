import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/usage'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'overview',
    titleKey: 'settings.usage.overview.title',
    aliases: ['用量统计', '用量分析', 'Usage Analytics']
  }
]
