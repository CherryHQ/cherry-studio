import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/services'
export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'service-management',
    titleKey: 'settings.prometheus.integration.services',
    aliases: ['Docker', 'Compose', 'SurrealDB', 'memory', 'setup', 'logs']
  },
  {
    anchorId: 'service-discovery',
    titleKey: 'settings.prometheus.integration.discoveredServices',
    groupKey: 'settings.prometheus.integration.services',
    aliases: ['existing', 'full pack', 'external', 'detect']
  }
]
