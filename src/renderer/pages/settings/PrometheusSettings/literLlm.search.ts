import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/liter-llm'
export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'liter-gateway-connection',
    titleKey: 'settings.prometheus.integration.literAdmin.gateway.title',
    groupKey: 'settings.prometheus.integration.literTitle',
    aliases: ['liter-llm', 'gateway', 'endpoint', 'installation', 'external gateway']
  },
  {
    anchorId: 'liter-provider-connections',
    titleKey: 'settings.prometheus.integration.literAdmin.connections.title',
    groupKey: 'settings.prometheus.integration.literTitle',
    aliases: ['provider', 'connection', 'credential', 'api key', 'base url']
  },
  {
    anchorId: 'liter-model-aliases',
    titleKey: 'settings.prometheus.integration.literAdmin.aliases.title',
    groupKey: 'settings.prometheus.integration.literTitle',
    aliases: ['model', 'alias', 'served model', 'mapping', 'catalog']
  },
  {
    anchorId: 'model-roles',
    titleKey: 'settings.prometheus.integration.literAdmin.roles.title',
    groupKey: 'settings.prometheus.integration.literTitle',
    aliases: ['judge', 'critic', 'backup', 'fallback', 'role assignment']
  },
  {
    anchorId: 'liter-gateway-configuration',
    titleKey: 'settings.prometheus.integration.literAdmin.config.title',
    groupKey: 'settings.prometheus.integration.literTitle',
    aliases: ['configuration', 'config', 'preview', 'apply', 'export', 'backup']
  },
  {
    anchorId: 'liter-gateway-diagnostics',
    titleKey: 'settings.prometheus.integration.literAdmin.diagnostics.title',
    groupKey: 'settings.prometheus.integration.literTitle',
    aliases: ['diagnostics', 'operational', 'authenticated', 'workspace', 'health']
  }
]
