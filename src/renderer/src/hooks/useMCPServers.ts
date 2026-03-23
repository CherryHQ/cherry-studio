import { dataApiService } from '@data/DataApiService'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import NavigationService from '@renderer/services/NavigationService'
import type { CreateMCPServerDto, UpdateMCPServerDto } from '@shared/data/api/schemas/mcpServers'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { IpcChannel } from '@shared/IpcChannel'
import { useCallback, useMemo } from 'react'
import { useSWRConfig } from 'swr'

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

// SWR cache matcher: invalidates both /mcp-servers (list) and /mcp-servers/:id (detail)
const mcpServersCacheMatcher = (key: unknown) =>
  Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith('/mcp-servers')

export const useMCPServers = () => {
  const { data, isLoading } = useQuery('/mcp-servers')
  const { mutate: globalMutate } = useSWRConfig()

  const invalidateAll = useCallback(() => globalMutate(mcpServersCacheMatcher), [globalMutate])

  const mcpServers = useMemo(() => data?.items ?? [], [data])
  const activedMcpServers = useMemo(() => mcpServers.filter((s) => s.isActive), [mcpServers])

  // POST /mcp-servers — fixed path, use useMutation
  const { trigger: createMCPServer } = useMutation('POST', '/mcp-servers')

  const addMCPServer = useCallback(
    async (dto: CreateMCPServerDto): Promise<MCPServer> => {
      const result = await createMCPServer({ body: dto })
      await invalidateAll()
      return result
    },
    [createMCPServer, invalidateAll]
  )

  // PATCH /mcp-servers/:id — dynamic ID, use dataApiService + invalidate all caches
  const updateMCPServer = useCallback(
    async (server: MCPServerUpdate): Promise<void> => {
      const { id, ...dto } = server
      await dataApiService.patch(`/mcp-servers/${encodeURIComponent(id)}`, { body: dto })
      await invalidateAll()
    },
    [invalidateAll]
  )

  // DELETE /mcp-servers/:id — dynamic ID, use dataApiService + invalidate all caches
  const deleteMCPServer = useCallback(
    async (id: string): Promise<void> => {
      await dataApiService.delete(`/mcp-servers/${encodeURIComponent(id)}`)
      await invalidateAll()
    },
    [invalidateAll]
  )

  return {
    mcpServers,
    activedMcpServers,
    isLoading,
    addMCPServer,
    updateMCPServer,
    deleteMCPServer,
    refetch: invalidateAll
  }
}

export const useMCPServer = (id: string) => {
  const path = `/mcp-servers/${encodeURIComponent(id)}` as const
  const { data: server, isLoading } = useQuery(path, { enabled: !!id })
  const { mutate: globalMutate } = useSWRConfig()

  const invalidateAll = useCallback(() => globalMutate(mcpServersCacheMatcher), [globalMutate])

  // PATCH /mcp-servers/:id — fixed path per hook instance, use useMutation
  const { trigger: patchServer } = useMutation('PATCH', path)

  // DELETE /mcp-servers/:id — fixed path per hook instance, use useMutation
  const { trigger: removeServer } = useMutation('DELETE', path)

  const updateMCPServer = useCallback(
    async (serverData: UpdateMCPServerDto): Promise<MCPServer> => {
      const result = await patchServer({ body: serverData })
      await invalidateAll()
      return result
    },
    [patchServer, invalidateAll]
  )

  const deleteMCPServer = useCallback(async (): Promise<void> => {
    await removeServer()
    await invalidateAll()
  }, [removeServer, invalidateAll])

  return {
    server,
    isLoading,
    updateMCPServer,
    deleteMCPServer,
    refetch: invalidateAll
  }
}
