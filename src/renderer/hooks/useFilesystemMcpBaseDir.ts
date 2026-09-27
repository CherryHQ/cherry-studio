import { useCallback, useMemo } from 'react'

import { useMcpServerMutations, useMcpServers } from '@renderer/hooks/useMcpServer'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

/**
 * Hook to manage the filesystem MCP server's base directory setting.
 * Finds the filesystem server and provides an update function for its baseDir.
 */
export const useFilesystemMcpBaseDir = () => {
  const { mcpServers, isLoading } = useMcpServers()

  const filesystemServer = useMemo(
    () => mcpServers.find((s) => s.name === BuiltinMcpServerNames.filesystem),
    [mcpServers]
  )

  const { updateMcpServer } = useMcpServerMutations(filesystemServer?.id || '')

  const updateBaseDir = useCallback(
    async (path: string) => {
      if (!filesystemServer?.id) return
      await updateMcpServer({
        body: {
          args: [path]
        }
      })
    },
    [filesystemServer?.id, updateMcpServer]
  )

  const baseDir = useMemo(() => filesystemServer?.args?.[0], [filesystemServer])

  return {
    filesystemServer,
    baseDir,
    isLoading,
    updateBaseDir
  }
}
