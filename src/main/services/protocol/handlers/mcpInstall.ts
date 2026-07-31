import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import { openSettingsInMainWindow } from '@main/services/mainWindowNavigation'
import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import * as z from 'zod'

const logger = loggerService.withContext('ProtocolService:mcpInstall')

const ProtocolMcpServerMetadataSchema = {
  name: z.string().min(1),
  description: z.string().optional()
}

const ProtocolMcpServerSchema = z.union([
  z.strictObject({
    ...ProtocolMcpServerMetadataSchema,
    type: z.enum(['sse', 'streamableHttp']).optional(),
    baseUrl: z.string().min(1)
  }),
  z.strictObject({
    ...ProtocolMcpServerMetadataSchema,
    type: z.literal('stdio').optional(),
    command: z.string().min(1),
    args: z.array(z.string()).optional()
  })
])

function toCreateMcpServerDto(value: unknown, fallbackName?: string): CreateMcpServerDto {
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

  const protocolServer = ProtocolMcpServerSchema.parse(candidate)

  return {
    ...protocolServer,
    installSource: 'protocol',
    isTrusted: false,
    isActive: false,
    installedAt: Date.now()
  }
}

function parseMcpServerDtos(value: unknown): CreateMcpServerDto[] {
  if (Array.isArray(value)) {
    return value.map((server) => toCreateMcpServerDto(server))
  }

  if (value && typeof value === 'object' && 'mcpServers' in value) {
    const servers = (value as { mcpServers?: unknown }).mcpServers
    if (Array.isArray(servers)) {
      return servers.map((server) => toCreateMcpServerDto(server))
    }
    if (!servers || typeof servers !== 'object') {
      throw new Error('mcpServers must be an object')
    }
    return Object.entries(servers).map(([name, server]) => toCreateMcpServerDto(server, name))
  }

  return [toCreateMcpServerDto(value)]
}

export function handleMcpProtocolUrl(url: URL) {
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

      const data = url.searchParams.get('servers')

      if (data) {
        const stringify = Buffer.from(data, 'base64').toString('utf8')
        const jsonConfig = JSON.parse(stringify)
        const serverDtos = parseMcpServerDtos(jsonConfig)
        if (serverDtos.length > 0) {
          const protocolInstall = encodeURIComponent(JSON.stringify(serverDtos))
          const protocolInstallRequestId = randomUUID()
          logger.debug('Prepared MCP protocol install preview', { count: serverDtos.length })
          openSettingsInMainWindow(
            `/settings/mcp/servers?protocolInstall=${protocolInstall}&protocolInstallRequestId=${protocolInstallRequestId}`
          )
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
