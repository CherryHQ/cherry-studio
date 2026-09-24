import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/liter-llm'
export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'gateway-connection',
    titleKey: 'settings.prometheus.integration.gatewayConnection',
    groupKey: 'settings.prometheus.integration.literTitle',
    aliases: ['liter-llm', 'gateway', 'endpoint', 'provider']
  },
  {
    anchorId: 'model-roles',
    titleKey: 'settings.prometheus.integration.modelMapping',
    groupKey: 'settings.prometheus.integration.literTitle',
    aliases: ['judge', 'critic', 'fallback', 'models']
  }
]
