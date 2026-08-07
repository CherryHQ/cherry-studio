import { loggerService } from '@logger'
import { ProtocolMcpServerConfigSchema, type ProtocolMcpServerInstall } from '@shared/data/types/mcpProtocolInstall'

const logger = loggerService.withContext('ProtocolService:mcpInstall')

function toProtocolMcpServerInstall(value: unknown, fallbackName?: string): ProtocolMcpServerInstall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MCP server config must be an object')
  }

  const candidate = { ...(value as Record<string, unknown>) }
  const legacyUrl = candidate.url

  delete candidate.url

  if (!candidate.name && fallbackName) {
    candidate.name = fallbackName
  }
  if (candidate.baseUrl === undefined && typeof legacyUrl === 'string') {
    candidate.baseUrl = legacyUrl
  }

  const protocolServer = ProtocolMcpServerConfigSchema.parse(candidate)

  return {
    ...protocolServer,
    installSource: 'protocol',
    isTrusted: false,
    isActive: false,
    installedAt: Date.now()
  }
}

function parseMcpServerDtos(value: unknown): ProtocolMcpServerInstall[] {
  if (Array.isArray(value)) {
    return value.map((server) => toProtocolMcpServerInstall(server))
  }

  if (value && typeof value === 'object' && 'mcpServers' in value) {
    const servers = (value as { mcpServers?: unknown }).mcpServers
    if (Array.isArray(servers)) {
      return servers.map((server) => toProtocolMcpServerInstall(server))
    }
    if (!servers || typeof servers !== 'object') {
      throw new Error('mcpServers must be an object')
    }
    return Object.entries(servers).map(([name, server]) => toProtocolMcpServerInstall(server, name))
  }

  return [toProtocolMcpServerInstall(value)]
}

export function parseMcpInstallProtocolUrl(url: URL): ProtocolMcpServerInstall[] | null {
  if (url.pathname !== '/install') {
    logger.error(`Unknown MCP protocol URL: ${url}`)
    return null
  }

  const data = url.searchParams.get('servers')
  if (!data) return null

  const jsonConfig = JSON.parse(Buffer.from(data, 'base64').toString('utf8'))
  const servers = parseMcpServerDtos(jsonConfig)
  return servers.length > 0 ? servers : null
}
