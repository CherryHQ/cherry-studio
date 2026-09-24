import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/uar'
export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'runtime-storage',
    titleKey: 'settings.prometheus.integration.uarBackend',
    panel: 'overview',
    groupKey: 'settings.prometheus.integration.uar',
    aliases: ['UAR', 'sidecar', 'runtime', 'SurrealDB', 'agent runtime']
  },
  {
    anchorId: 'runtime-status',
    titleKey: 'settings.prometheus.integration.uarProcess',
    panel: 'overview',
    groupKey: 'settings.prometheus.integration.uar',
    aliases: ['apply', 'restart', 'capabilities', 'version']
  },
  ...[
    ['overview', ['health', 'readiness', 'metrics', 'capabilities']],
    ['providers-models', ['provider', 'model', 'routing', 'catalog']],
    ['runtime-settings', ['configuration', 'namespace', 'drift', 'policy']],
    ['agents', ['agent catalog', 'agent definition', 'registry']],
    ['compiler', ['UAR-AGENT-MD', 'compile', 'specification']],
    ['skills', ['skill pack', 'provenance', 'refresh']],
    ['presentations', ['A2UI', 'presentation', 'component']],
    ['runs', ['AG-UI', 'run', 'session', 'checkpoint']],
    ['knowledge', ['knowledge base', 'memory', 'RAG']],
    ['tools', ['tool catalog', 'MCP server']],
    ['security', ['credential', 'API key', 'governance']],
    ['protocols', ['A2A', 'ACP', 'protocol']],
    ['diagnostics', ['diagnostics', 'stream', 'health']],
    ['legacy-api', ['retired', 'legacy API']]
  ].map(([panel, aliases]) => ({
    anchorId: panel as string,
    titleKey: `settings.prometheus.integration.uarAdmin.surface.${panel}`,
    descriptionKey: 'settings.prometheus.integration.uarAdmin.surfaceDescription',
    panel: panel as string,
    groupKey: 'settings.prometheus.integration.uar',
    aliases: aliases as string[]
  }))
]
