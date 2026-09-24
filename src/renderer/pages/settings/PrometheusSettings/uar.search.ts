import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/uar'
export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'runtime-storage',
    titleKey: 'settings.prometheus.integration.uarBackend',
    groupKey: 'settings.prometheus.integration.uar',
    aliases: ['UAR', 'sidecar', 'runtime', 'SurrealDB', 'agent runtime']
  },
  {
    anchorId: 'runtime-status',
    titleKey: 'settings.prometheus.integration.uarProcess',
    groupKey: 'settings.prometheus.integration.uar',
    aliases: ['apply', 'restart', 'capabilities', 'version']
  }
]
