import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import NavigationService from '@renderer/services/NavigationService'
import {
  type CreateMCPServerDto,
  type ListMCPServersQuery,
  stripReadOnlyMCPServerFields,
  type UpdateMCPServerDto
} from '@shared/data/api/schemas/mcpServers'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { IpcChannel } from '@shared/IpcChannel'
import { useCallback, useMemo } from 'react'

// Navigate to MCP server settings when a server is installed via URL scheme
window.electron.ipcRenderer.on(IpcChannel.Mcp_AddServer, (_event, server: { id: string }) => {
  void NavigationService.navigate?.({ to: '/settings/mcp' })
  void NavigationService.navigate?.({ to: `/settings/mcp/settings/${server.id}` })
})

type ReadOnlyMcpServerFields = Pick<MCPServer, 'id' | 'createdAt' | 'updatedAt'>
type CreateMcpServerInput = CreateMCPServerDto & Partial<ReadOnlyMcpServerFields>
type UpdateMcpServerInput = UpdateMCPServerDto & Partial<ReadOnlyMcpServerFields>

/**
 * MCP servers list hook — data fetching with optional filters and create mutation.
 */
export const useMcpServers = (query?: ListMCPServersQuery) => {
  const { data, isLoading, mutate } = useQuery('/mcp-servers', { query })

  const mcpServers = useMemo(() => data?.items ?? [], [data])

  const { trigger: createMcpServer } = useMutation('POST', '/mcp-servers', {
    refresh: ['/mcp-servers']
  })

  const addMcpServer = useCallback(
    (dto: CreateMcpServerInput) => createMcpServer({ body: stripReadOnlyMCPServerFields(dto) }),
    [createMcpServer]
  )

  const { trigger: reorderTrigger } = useMutation('PATCH', '/mcp-servers', {
    refresh: ['/mcp-servers']
  })

  const reorderMcpServers = useCallback(
    (reorderedList: MCPServer[]) => {
      void mutate(data ? { ...data, items: reorderedList } : undefined, false)
      reorderTrigger({ body: { orderedIds: reorderedList.map((s) => s.id) } }).catch((error) => {
        loggerService.withContext('useMcpServers').warn('Failed to reorder MCP servers, reverting', error as Error)
        void mutate()
      })
    },
    [data, mutate, reorderTrigger]
  )

  return {
    mcpServers,
    isLoading,
    addMcpServer,
    reorderMcpServers,
    refetch: mutate
  }
}

/**
 * Single MCP server hook — read + update + delete.
 * Fetches via the list endpoint with an id filter (separate SWR cache entry
 * from the unfiltered list). Mutations use refresh: ['/mcp-servers'] to
 * auto-invalidate all /mcp-servers caches (list, filtered, and detail).
 */
export const useMcpServer = (id: string) => {
  const { data, isLoading } = useQuery('/mcp-servers', {
    query: { id },
    enabled: !!id
  })

  const { updateMcpServer, deleteMcpServer } = useMcpServerMutations(id)

  const server = useMemo(() => data?.items?.[0], [data])

  return { server, isLoading, updateMcpServer, deleteMcpServer }
}

/**
 * Mutation-only hook for a single MCP server — no query, no N+1.
 * Use when server data is already available from a parent (e.g. from useMcpServers list).
 */
export const useMcpServerMutations = (id: string) => {
  const path = `/mcp-servers/${id}` as const

  const { trigger: updateMcpServerTrigger } = useMutation('PATCH', path, {
    refresh: ['/mcp-servers']
  })

  type UpdateMcpServerArgs = Omit<NonNullable<Parameters<typeof updateMcpServerTrigger>[0]>, 'body'> & {
    body?: UpdateMcpServerInput
  }

  const updateMcpServer = useCallback(
    (data?: UpdateMcpServerArgs) => {
      if (!data?.body) return updateMcpServerTrigger(data)
      return updateMcpServerTrigger({ ...data, body: stripReadOnlyMCPServerFields(data.body) })
    },
    [updateMcpServerTrigger]
  )

  const { trigger: deleteMcpServer } = useMutation('DELETE', path, {
    refresh: ['/mcp-servers']
  })

  return { updateMcpServer, deleteMcpServer }
}
