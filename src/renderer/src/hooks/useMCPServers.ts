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

  // POST /mcp-servers — fixed path, use useMutation
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
      await dataApiService.patch(`/mcp-servers/${id}`, { body: dto })
      await mutate()
    },
    [mutate]
  )

  // DELETE /mcp-servers/:id — dynamic ID, use dataApiService + refetch list
  const deleteMCPServer = useCallback(
    async (id: string): Promise<void> => {
      await dataApiService.delete(`/mcp-servers/${id}`)
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

export const useMCPServer = (id: string) => {
  const path = `/mcp-servers/${id}` as const
  const { data: server, isLoading, mutate } = useQuery(path, { enabled: !!id })

  // PATCH /mcp-servers/:id — fixed path per hook instance, use useMutation
  const { trigger: patchServer } = useMutation('PATCH', path, {
    refresh: ['/mcp-servers']
  })

  // DELETE /mcp-servers/:id — fixed path per hook instance, use useMutation
  const { trigger: removeServer } = useMutation('DELETE', path, {
    refresh: ['/mcp-servers']
  })

  const updateMCPServer = useCallback(
    async (serverData: UpdateMCPServerDto): Promise<MCPServer> => {
      const result = await patchServer({ body: serverData })
      await mutate()
      return result
    },
    [patchServer, mutate]
  )

  const deleteMCPServer = useCallback(async (): Promise<void> => {
    await removeServer()
  }, [removeServer])

  return {
    server,
    isLoading,
    updateMCPServer,
    deleteMCPServer,
    refetch: mutate
  }
}
