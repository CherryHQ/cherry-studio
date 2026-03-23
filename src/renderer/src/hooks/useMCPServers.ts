import { useMutation, useQuery } from '@data/hooks/useDataApi'
import NavigationService from '@renderer/services/NavigationService'
import type { CreateMCPServerDto, ListMCPServersQuery } from '@shared/data/api/schemas/mcpServers'
import { IpcChannel } from '@shared/IpcChannel'
import { useCallback, useMemo } from 'react'

// Navigate to MCP server settings when a server is installed via URL scheme
window.electron.ipcRenderer.on(IpcChannel.Mcp_AddServer, (_event, server: { id: string }) => {
  void NavigationService.navigate?.({ to: '/settings/mcp' })
  void NavigationService.navigate?.({ to: `/settings/mcp/settings/${server.id}` })
})

/**
 * MCP servers list hook — data fetching with optional filters and create mutation.
 */
export const useMCPServers = (query?: ListMCPServersQuery) => {
  const { data, isLoading, mutate } = useQuery('/mcp-servers', { query })

  const mcpServers = useMemo(() => data?.items ?? [], [data])

  const { trigger: createMCPServer } = useMutation('POST', '/mcp-servers', {
    refresh: ['/mcp-servers']
  })

  const addMCPServer = useCallback((dto: CreateMCPServerDto) => createMCPServer({ body: dto }), [createMCPServer])

  return {
    mcpServers,
    isLoading,
    addMCPServer,
    refetch: mutate
  }
}

/**
 * Single MCP server hook — read + update + delete.
 * SWR key is ['/mcp-servers', { id }], mutations use refresh: ['/mcp-servers']
 * to auto-invalidate all /mcp-servers caches (list, filtered, and detail).
 */
export const useMCPServer = (id: string) => {
  const path = `/mcp-servers/${id}` as const

  const { data, isLoading } = useQuery('/mcp-servers', {
    query: { id },
    enabled: !!id
  })

  const { trigger: updateMCPServer } = useMutation('PATCH', path, {
    refresh: ['/mcp-servers']
  })

  const { trigger: deleteMCPServer } = useMutation('DELETE', path, {
    refresh: ['/mcp-servers']
  })

  const server = useMemo(() => data?.items?.[0], [data])

  return { server, isLoading, updateMCPServer, deleteMCPServer }
}
