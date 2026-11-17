import { safeValidateMcpConfig } from '@renderer/types/mcp'
import type { McpServer } from '@shared/data/types/mcpServer'
import { isBuiltinMcpServerName } from '@shared/utils/mcp'

export class DuplicateMcpServerNameError extends Error {
  constructor(public readonly serverName: string) {
    super('duplicate_mcp_server_name')
    this.name = 'DuplicateMcpServerNameError'
  }
}

export function isExportableMcpServer(server: McpServer): boolean {
  return server.type !== 'inMemory' && server.installSource !== 'builtin' && !isBuiltinMcpServerName(server.name)
}

export function serializeMcpServersForExport(servers: readonly McpServer[]): string {
  const eligible = servers.filter(isExportableMcpServer)
  if (eligible.length === 0) throw new Error('no_exportable_mcp_servers')

  const names = new Set<string>()
  for (const server of eligible) {
    if (names.has(server.name)) throw new DuplicateMcpServerNameError(server.name)
    if (server.name === '__proto__') throw new Error('unsupported_mcp_server_name')
    names.add(server.name)
  }

  const payload = {
    mcpServers: Object.fromEntries(
      eligible.map((server) => [
        server.name,
        Object.fromEntries(
          Object.entries({
            name: server.name,
            type: server.type ?? (server.baseUrl ? 'sse' : 'stdio'),
            description: server.description,
            url: server.baseUrl,
            command: server.command,
            registryUrl: server.registryUrl,
            args: server.args,
            env: server.env,
            headers: server.headers,
            provider: server.provider,
            providerUrl: server.providerUrl,
            logoUrl: server.logoUrl,
            tags: server.tags,
            longRunning: server.longRunning,
            timeout: server.timeout,
            dxtVersion: server.dxtVersion,
            dxtPath: server.dxtPath,
            reference: server.reference,
            searchKey: server.searchKey,
            configSample: server.configSample,
            disabledTools: server.disabledTools,
            disabledAutoApproveTools: server.disabledAutoApproveTools,
            shouldConfig: server.shouldConfig
          }).filter(([, value]) => value !== undefined)
        )
      ])
    )
  }
  const parsed = safeValidateMcpConfig(payload)
  if (!parsed.success || Object.keys(parsed.data.mcpServers).length !== eligible.length) {
    throw new Error('invalid_mcp_export')
  }
  return JSON.stringify(payload, null, 2)
}
