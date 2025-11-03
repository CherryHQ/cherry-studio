import { loggerService } from '@logger'
import type { MCPServer } from '@renderer/types'

const logger = loggerService.withContext('MCPSettings/utils')

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
  updateServer: (server: MCPServer) => void
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

  // Request user confirmation via callback
  const confirmed = await requestConfirm(currentServer)

  if (!confirmed) {
    return null
  }

  // Update server with trust information
  const trustedServer = {
    ...currentServer,
    installSource: 'protocol' as const,
    isTrusted: true,
    trustedAt: Date.now()
  }
  updateServer(trustedServer)
  return trustedServer
}
