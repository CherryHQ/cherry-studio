import { dataApiService } from '@data/DataApiService'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import NavigationService from '@renderer/services/NavigationService'
import type { CreateMCPServerDto, UpdateMCPServerDto } from '@shared/data/api/schemas/mcpServers'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { IpcChannel } from '@shared/IpcChannel'
import { useCallback, useMemo } from 'react'

// Navigate to MCP server settings when a server is installed via URL scheme
window.electron.ipcRenderer.on(IpcChannel.Mcp_AddServer, (_event, server: { id: string }) => {
  void NavigationService.navigate?.({ to: '/settings/mcp' })
  void NavigationService.navigate?.({ to: `/settings/mcp/settings/${server.id}` })
})

/**
 * Server-like object with at least an `id` and any update fields.
 * Accepts both legacy MCPServer from @renderer/types and new MCPServer from @shared/data/types.
 */
type MCPServerUpdate = { id: string } & Partial<Omit<MCPServer, 'id' | 'createdAt' | 'updatedAt'>>

export const useMCPServers = () => {
  const { data, isLoading, mutate } = useQuery('/mcp-servers')

  const mcpServers = useMemo(() => data?.items ?? [], [data])
  const activedMcpServers = useMemo(() => mcpServers.filter((s) => s.isActive), [mcpServers])

  // POST /mcp-servers
  const { trigger: createMCPServer } = useMutation('POST', '/mcp-servers', {
    refresh: ['/mcp-servers']
  })

  const addMCPServer = useCallback(
    async (dto: CreateMCPServerDto): Promise<MCPServer> => {
      return createMCPServer({ body: dto })
    },
    [createMCPServer]
  )

  // PATCH /mcp-servers/:id — dynamic ID, use dataApiService + refetch list
  const updateMCPServer = useCallback(
    async (server: MCPServerUpdate): Promise<void> => {
      const { id, ...dto } = server
      await dataApiService.patch(`/mcp-servers/${encodeURIComponent(id)}`, { body: dto })
      await mutate()
    },
    [mutate]
  )

  // DELETE /mcp-servers/:id — dynamic ID, use dataApiService + refetch list
  const deleteMCPServer = useCallback(
    async (id: string): Promise<void> => {
      await dataApiService.delete(`/mcp-servers/${encodeURIComponent(id)}`)
      await mutate()
    },
    [mutate]
  )

  return {
    mcpServers,
    activedMcpServers,
    isLoading,
    addMCPServer,
    updateMCPServer,
    deleteMCPServer,
    refetch: mutate
  }
}

/**
 * Single MCP server hook — derives from the list cache.
 * No separate API call needed since the list returns full MCPServer objects.
 */
export const useMCPServer = (id: string) => {
  const { data, isLoading, mutate } = useQuery('/mcp-servers')

  const server = useMemo(() => data?.items?.find((s) => s.id === id), [data, id])

  const updateMCPServer = useCallback(
    async (serverData: UpdateMCPServerDto): Promise<MCPServer> => {
      const result = await dataApiService.patch(`/mcp-servers/${encodeURIComponent(id)}`, { body: serverData })
      await mutate()
      return result
    },
    [id, mutate]
  )

  const deleteMCPServer = useCallback(async (): Promise<void> => {
    await dataApiService.delete(`/mcp-servers/${encodeURIComponent(id)}`)
    await mutate()
  }, [id, mutate])

  return {
    server,
    isLoading,
    updateMCPServer,
    deleteMCPServer,
    refetch: mutate
  }
}
