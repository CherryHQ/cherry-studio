import type { SettingsSearchEntry } from '../settingsSearch/types'

// The MCP section's static tabs are real sub-routes: entries override the
// route to land directly on the tab; anchors point at the tab menu items in
// McpSettingsPage's sidebar. Server entries themselves are dynamic entities
// and stay unindexed per D8 (baseline section title still matches).
export const route = '/settings/mcp'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'tab-servers',
    titleKey: 'settings.mcp.title',
    route: '/settings/mcp/servers',
    aliases: ['mcp']
  },
  {
    anchorId: 'tab-builtin',
    titleKey: 'settings.mcp.builtinServers',
    route: '/settings/mcp/builtin'
  },
  {
    anchorId: 'tab-marketplaces',
    titleKey: 'settings.mcp.marketplaces',
    route: '/settings/mcp/marketplaces'
  }
]
