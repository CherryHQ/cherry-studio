import type { MCPServer } from '@renderer/types'
import { useCallback } from 'react'

/**
 * Stub hook - MCPSettings/ProtocolInstallWarning, MCPSettings/utils, and useMCPServers
 * have been removed. Returns a no-op ensureServerTrusted that passes all servers through.
 */
export const useMCPServerTrust = () => {
  const ensureServerTrusted = useCallback(async (server: MCPServer): Promise<MCPServer | null> => {
    return server
  }, [])

  return { ensureServerTrusted }
}
