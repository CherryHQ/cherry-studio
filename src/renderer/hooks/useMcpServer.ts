import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { McpTool } from '@renderer/types/tool'
import { resolveMcpSourceToolAccess } from '@shared/ai/tools/mcpSourcePolicy'
import type { CreateMcpServerDto, ListMcpServersQuery } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { useCallback, useMemo } from 'react'

/**
 * MCP servers list hook — data fetching with optional filters and create mutation.
 */
export const useMcpServers = (query?: ListMcpServersQuery, options: { enabled?: boolean } = {}) => {
  const { data, isLoading, mutate } = useQuery('/mcp-servers', { query, enabled: options.enabled })

  const mcpServers = useMemo(() => data?.items ?? [], [data])

  const { trigger: createMcpServer } = useMutation('POST', '/mcp-servers', {
    refresh: ['/mcp-servers']
  })

  const addMcpServer = useCallback((dto: CreateMcpServerDto) => createMcpServer({ body: dto }), [createMcpServer])

  const { trigger: reorderTrigger } = useMutation('PATCH', '/mcp-servers', {
    refresh: ['/mcp-servers']
  })

  const reorderMcpServers = useCallback(
    (reorderedList: McpServer[]) => {
      void mutate(data ? { ...data, items: reorderedList } : undefined, false)
      reorderTrigger({ body: { orderedIds: reorderedList.map((s) => s.id) } }).catch((error) => {
        loggerService.withContext('useMcpServer').warn('Failed to reorder MCP servers, reverting', error as Error)
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
 * Active MCP servers reachable from one conversation: `'all'` for auto mode, an explicit id list for
 * manual / agent bindings, `null` when MCP is off (skips the query entirely). Inactive servers are
 * always dropped — a disabled server can serve neither tools nor prompts nor resources.
 *
 * Pass a memoized `boundServerIds` array; it is a dependency of the filter.
 */
export const useScopedMcpServers = (
  boundServerIds: readonly string[] | 'all' | null,
  options: { enabled?: boolean } = {}
) => {
  const { mcpServers, isLoading } = useMcpServers(undefined, {
    enabled: (options.enabled ?? true) && boundServerIds !== null
  })

  const servers = useMemo(() => {
    if (boundServerIds === null) return []
    const bound = boundServerIds === 'all' ? null : new Set(boundServerIds)
    return mcpServers.filter((server) => server.isActive && (!bound || bound.has(server.id)))
  }, [boundServerIds, mcpServers])

  return { servers, isLoading }
}

/**
 * Single MCP server hook — read + update. Fetches via the list endpoint with
 * an id filter (separate SWR cache entry from the unfiltered list). Mutations
 * use refresh: ['/mcp-servers'] to auto-invalidate all /mcp-servers caches.
 */
export const useMcpServer = (id: string) => {
  const { data, isLoading } = useQuery('/mcp-servers', {
    query: { id },
    enabled: !!id
  })

  const { updateMcpServer } = useMcpServerMutations(id)

  const server = useMemo(() => data?.items?.[0], [data])

  return { server, isLoading, updateMcpServer }
}

/**
 * Resolve auto-approval for a tool without plumbing the server prop through
 * every renderer. Reads the server list from the shared `/mcp-servers` SWR
 * query.
 */
export const useIsToolAutoApproved = (tool: McpTool): boolean => {
  const { mcpServers } = useMcpServers()
  return useMemo(() => {
    const server = mcpServers.find((s) => s.id === tool.serverId)
    return server ? resolveMcpSourceToolAccess(server, tool).approval === 'auto' : false
  }, [mcpServers, tool])
}

/**
 * Mutation-only hook for a single MCP server — no query, no N+1.
 * Use when server data is already available from a parent (e.g. from useMcpServers list).
 *
 * Removal goes through the `mcp.server.remove` IPC channel (main orchestrates
 * runtime cleanup + row deletion), not DataApi.
 */
export const useMcpServerMutations = (id: string) => {
  const path = `/mcp-servers/${id}` as const

  const { trigger: updateMcpServer } = useMutation('PATCH', path, {
    refresh: ['/mcp-servers']
  })

  const invalidateCache = useInvalidateCache()

  const removeMcpServer = useCallback(async () => {
    await ipcApi.request('mcp.server.remove', { serverId: id })
    // The delete is committed once the IPC call returns — a failed cache
    // refresh must not surface as a delete failure.
    await invalidateCache('/mcp-servers').catch((error) =>
      loggerService.withContext('useMcpServer').warn('Failed to refresh MCP server cache after delete', error as Error)
    )
  }, [id, invalidateCache])

  return { updateMcpServer, removeMcpServer }
}
