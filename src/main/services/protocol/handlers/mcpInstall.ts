import { loggerService } from '@logger'
import { ProtocolMcpServerConfigSchema, type ProtocolMcpServerInstall } from '@shared/data/types/mcpProtocolInstall'

const logger = loggerService.withContext('ProtocolService:mcpInstall')

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Protocol URLs decode arbitrary JSON; normalize legacy URL/name fields, then apply the existing MCP install schema before returning an inactive untrusted server.
function toProtocolMcpServerInstall(value: unknown, fallbackName?: string): ProtocolMcpServerInstall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MCP server config must be an object')
  }

  // oxlint-disable-next-line anti-slop/no-known-value-widening -- Legacy field values remain unvalidated until ProtocolMcpServerConfigSchema parses the normalized candidate.
  const candidate: { url?: unknown; name?: unknown; baseUrl?: unknown } = { ...value }
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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Base64 protocol JSON supports single configs, arrays and mcpServers maps; identify the container before validating every server entry.
function parseMcpServerDtos(value: unknown): ProtocolMcpServerInstall[] {
  if (Array.isArray(value)) {
    return value.map((server) => toProtocolMcpServerInstall(server))
  }

  if (value && typeof value === 'object' && 'mcpServers' in value) {
    const servers = value.mcpServers

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
