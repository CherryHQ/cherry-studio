import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import NavigationService from '@renderer/services/NavigationService'
import type { MCPTool } from '@renderer/types'
import { findMcpServerByTool, isToolAutoApproved } from '@renderer/utils/mcp-tools'
import type { CreateMCPServerDto, ListMCPServersQuery } from '@shared/data/api/schemas/mcpServers'
import type { MCPServer } from '@shared/data/types/mcpServer'
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

  const { trigger: reorderTrigger } = useMutation('PATCH', '/mcp-servers', {
    refresh: ['/mcp-servers']
  })

  const reorderMCPServers = useCallback(
    (reorderedList: MCPServer[]) => {
      void mutate(data ? { ...data, items: reorderedList } : undefined, false)
      reorderTrigger({ body: { orderedIds: reorderedList.map((s) => s.id) } }).catch((error) => {
        loggerService.withContext('useMCPServers').warn('Failed to reorder MCP servers, reverting', error as Error)
        void mutate()
      })
    },
    [data, mutate, reorderTrigger]
  )

  return {
    mcpServers,
    isLoading,
    addMCPServer,
    reorderMCPServers,
    refetch: mutate
  }
}

/**
 * Single MCP server hook — read + update + delete.
 * Fetches via the list endpoint with an id filter (separate SWR cache entry
 * from the unfiltered list). Mutations use refresh: ['/mcp-servers'] to
 * auto-invalidate all /mcp-servers caches (list, filtered, and detail).
 */
export const useMCPServer = (id: string) => {
  const { data, isLoading } = useQuery('/mcp-servers', {
    query: { id },
    enabled: !!id
  })

  const { updateMCPServer, deleteMCPServer } = useMCPServerMutations(id)

  const server = useMemo(() => data?.items?.[0], [data])

  return { server, isLoading, updateMCPServer, deleteMCPServer }
}

/**
 * Mutation-only hook for a single MCP server — no query, no N+1.
 * Use when server data is already available from a parent (e.g. from useMCPServers list).
 */
/**
 * Resolve `isToolAutoApproved` for a tool without plumbing the server prop
 * through every renderer. Reads the server list from the shared
 * `/mcp-servers` SWR query and falls back to the `hub` built-in constant.
 */
export const useIsToolAutoApproved = (tool: MCPTool, allowedTools?: string[]): boolean => {
  const { mcpServers } = useMCPServers()
  return useMemo(() => {
    const server = findMcpServerByTool(mcpServers, tool)
    return isToolAutoApproved(tool, server, allowedTools)
  }, [mcpServers, tool, allowedTools])
}

export const useMCPServerMutations = (id: string) => {
  const path = `/mcp-servers/${id}` as const

  const { trigger: updateMCPServer } = useMutation('PATCH', path, {
    refresh: ['/mcp-servers']
  })

  const { trigger: deleteMCPServer } = useMutation('DELETE', path, {
    refresh: ['/mcp-servers']
  })

  return { updateMCPServer, deleteMCPServer }
}
