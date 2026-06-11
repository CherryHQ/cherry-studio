import { loggerService } from '@logger'
import type { CreateMcpServerDto, UpdateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'

const logger = loggerService.withContext('McpSettings/utils')

type McpServerDraft = Partial<McpServer> & { url?: string }
type CreateMcpServerDraft = McpServerDraft & Pick<McpServer, 'name'>

const stripReadonlyMcpServerFields = (server: McpServerDraft): UpdateMcpServerDto => {
  const dto = { ...server }
  // Keep this aligned with fields that strict create/update DTO schemas reject.
  delete dto.id
  delete dto.createdAt
  delete dto.updatedAt
  delete dto.url
  return dto
}

export const toCreateMcpServerDto = (server: CreateMcpServerDraft): CreateMcpServerDto => {
  const dto: CreateMcpServerDto = { ...stripReadonlyMcpServerFields(server), name: server.name }

  if (dto.baseUrl === undefined && server.url !== undefined) {
    dto.baseUrl = server.url
  }

  return dto
}

export const toUpdateMcpServerDto = (server: McpServerDraft): UpdateMcpServerDto => {
  return stripReadonlyMcpServerFields(server)
}

export const isSameMcpServerCandidate = (existing: McpServer, candidate: McpServer): boolean => {
  if (candidate.baseUrl && existing.baseUrl === candidate.baseUrl) {
    return true
  }

  if (candidate.provider && existing.provider === candidate.provider) {
    return (
      (candidate.providerUrl !== undefined && existing.providerUrl === candidate.providerUrl) ||
      existing.name === candidate.name
    )
  }

  if (candidate.installSource === 'builtin') {
    return existing.name === candidate.name
  }

  return false
}

/**
 * Whitelist of trusted MCP server URLs that auto-approve without user confirmation
 */
const TRUSTED_SERVER_WHITELIST: readonly string[] = [
  'http://127.0.0.1:18930/mcp' // WPS Notes
]

/**
 * Check if a server URL is in the trusted whitelist
 */
function isServerInWhitelist(server: McpServer): boolean {
  const isUrlBasedServer = server.type === 'sse' || server.type === 'streamableHttp'
  if (!isUrlBasedServer || !server.baseUrl) {
    return false
  }
  return TRUSTED_SERVER_WHITELIST.includes(server.baseUrl)
}

/**
 * Get command preview string from MCP server configuration
 * @param server - The MCP server to extract command from
 * @returns Formatted command string with arguments
 */
export const getCommandPreview = (server: McpServer): string => {
  return [server.command, ...(server.args ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
}

/**
 * Ensures a server is trusted before proceeding (pure logic, no UI)
 * @param currentServer - The server to verify trust for
 * @param requestConfirm - Callback to request user confirmation
 * @param updateServer - Callback to update server state
 * @returns The trusted server if confirmed, or null if user declined
 */
export async function ensureServerTrusted(
  currentServer: McpServer,
  requestConfirm: (server: McpServer) => Promise<boolean>,
  updateServer: (body: UpdateMcpServerDto) => void
): Promise<McpServer | null> {
  const isProtocolInstall = currentServer.installSource === 'protocol'

  logger.silly('ensureServerTrusted', {
    serverId: currentServer.id,
    installSource: currentServer.installSource,
    isTrusted: currentServer.isTrusted
  })

  // Early return if no trust verification needed
  if (!isProtocolInstall || currentServer.isTrusted) {
    return currentServer
  }

  // Auto-trust whitelisted servers (e.g., WPS Notes)
  if (isServerInWhitelist(currentServer)) {
    logger.info('Auto-trusting whitelisted server', {
      serverId: currentServer.id,
      baseUrl: currentServer.baseUrl
    })

    const trustFields = {
      installSource: 'protocol' as const,
      isTrusted: true,
      trustedAt: Date.now()
    }
    updateServer(trustFields)

    return { ...currentServer, ...trustFields }
  }

  // Request user confirmation via callback
  const confirmed = await requestConfirm(currentServer)

  if (!confirmed) {
    return null
  }

  // Update server with trust information
  const trustFields = {
    installSource: 'protocol' as const,
    isTrusted: true,
    trustedAt: Date.now()
  }
  updateServer(trustFields)

  return { ...currentServer, ...trustFields }
}
