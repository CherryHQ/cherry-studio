import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/compass'
export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'graph-storage',
    titleKey: 'settings.prometheus.integration.storage',
    groupKey: 'settings.prometheus.integration.compassTitle',
    aliases: ['Compass', 'graph', 'index', 'SQLite', 'JSON', 'SurrealDB']
  },
  {
    anchorId: 'workspace-index',
    titleKey: 'settings.prometheus.integration.workspace',
    groupKey: 'settings.prometheus.integration.compassTitle',
    aliases: ['workspace', 'refresh', 'drift', 'project skills']
  },
  {
    anchorId: 'filesystem-mcp',
    titleKey: 'settings.prometheus.integration.filesystem',
    groupKey: 'settings.prometheus.integration.compassTitle',
    aliases: ['Rust Filesystem', 'MCP', 'roots', 'write access']
  }
]
