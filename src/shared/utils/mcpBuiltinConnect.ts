import { resolveZoneFoundryMcpBaseUrl } from '@shared/data/presets/zonefoundryMcp'
import type { McpServer } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

export function resolveBuiltinMcpConnectBaseUrl(server: McpServer, inChina: boolean): string | undefined {
  if (server.installSource === 'builtin' && server.name === BuiltinMcpServerNames.zonefoundry) {
    return resolveZoneFoundryMcpBaseUrl(inChina)
  }
  return server.baseUrl
}
