import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { openSettingsInMainWindow } from '@main/services/mainWindowNavigation'
import { type CreateMcpServerDto, CreateMcpServerSchema } from '@shared/data/api/schemas/mcpServers'

const logger = loggerService.withContext('ProtocolService:mcpInstall')

function toCreateMcpServerDto(value: unknown, fallbackName?: string): CreateMcpServerDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MCP server config must be an object')
  }

  const candidate = { ...(value as Record<string, unknown>) }
  const legacyUrl = candidate.url

  delete candidate.id
  delete candidate.createdAt
  delete candidate.updatedAt
  delete candidate.url

  if (!candidate.name && fallbackName) {
    candidate.name = fallbackName
  }
  if (candidate.baseUrl === undefined && typeof legacyUrl === 'string') {
    candidate.baseUrl = legacyUrl
  }

  return CreateMcpServerSchema.parse({
    ...candidate,
    installSource: 'protocol',
    isTrusted: false,
    isActive: false,
    trustedAt: undefined,
    installedAt: candidate.installedAt ?? Date.now()
  })
}

function parseMcpServerDtos(value: unknown): CreateMcpServerDto[] {
  if (Array.isArray(value)) {
    return value.map((server) => toCreateMcpServerDto(server))
  }

  if (value && typeof value === 'object' && 'mcpServers' in value) {
    const servers = (value as { mcpServers?: unknown }).mcpServers
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
      throw new Error('mcpServers must be an object')
    }
    return Object.entries(servers).map(([name, server]) => toCreateMcpServerDto(server, name))
  }

  return [toCreateMcpServerDto(value)]
}

export function handleMcpProtocolUrl(url: URL) {
  const params = new URLSearchParams(url.search)
  switch (url.pathname) {
    case '/install': {
      // jsonConfig example:
      // {
      //   "mcpServers": {
      //     "everything": {
      //       "command": "npx",
      //       "args": [
      //         "-y",
      //         "@modelcontextprotocol/server-everything"
      //       ]
      //     }
      //   }
      // }
      // cherrystudio://mcp/install?servers={base64Encode(JSON.stringify(jsonConfig))}

      const data = params.get('servers')

      if (data) {
        const stringify = Buffer.from(data, 'base64').toString('utf8')
        const jsonConfig = JSON.parse(stringify)
        const serverDtos = parseMcpServerDtos(jsonConfig)
        const createdServers = serverDtos.map((server) => mcpServerService.create(server))

        logger.debug('Installed MCP servers from protocol', { count: createdServers.length })

        const lastCreatedServer = createdServers.at(-1)
        if (lastCreatedServer) {
          openSettingsInMainWindow(`/settings/mcp/settings/${lastCreatedServer.id}`, { delivery: 'init-data' })
          break
        }
      }

      application.get('MainWindowService').showMainWindow()

      break
    }
    default:
      logger.error(`Unknown MCP protocol URL: ${url}`)
      break
  }
}
