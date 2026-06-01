import { loggerService } from '@logger'
import type { CreateMCPServerDto, UpdateMCPServerDto } from '@shared/data/api/schemas/mcpServers'
import type { MCPServer } from '@shared/data/types/mcpServer'

const logger = loggerService.withContext('McpSettings/utils')

type McpServerDraft = Partial<MCPServer> & { url?: string }
type CreateMcpServerDraft = McpServerDraft & Pick<MCPServer, 'name'>

export const toCreateMcpServerDto = (server: CreateMcpServerDraft): CreateMCPServerDto => {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, url, ...fields } = server
  const dto: CreateMCPServerDto = { ...fields }

  if (dto.baseUrl === undefined && url !== undefined) {
    dto.baseUrl = url
  }

  return dto
}

export const toUpdateMcpServerDto = (server: McpServerDraft): UpdateMCPServerDto => {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, url: _url, ...fields } = server
  return fields
}

export const isSameMcpServerCandidate = (existing: MCPServer, candidate: MCPServer): boolean => {
  if (candidate.provider && existing.provider === candidate.provider) {
    return (
      (candidate.providerUrl !== undefined && existing.providerUrl === candidate.providerUrl) ||
      (candidate.baseUrl !== undefined && existing.baseUrl === candidate.baseUrl) ||
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
function isServerInWhitelist(server: MCPServer): boolean {
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
export const getCommandPreview = (server: MCPServer): string => {
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
  currentServer: MCPServer,
  requestConfirm: (server: MCPServer) => Promise<boolean>,
  updateServer: (body: UpdateMCPServerDto) => void
): Promise<MCPServer | null> {
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
