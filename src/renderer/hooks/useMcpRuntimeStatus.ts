import { useSharedCacheSelector, useSharedCacheValue } from '@renderer/data/hooks/useCache'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import { useCallback, useMemo } from 'react'

type McpStatusCacheKey = `mcp.status.${string}`

export const mcpStatusCacheKey = (serverId: string): McpStatusCacheKey => `mcp.status.${serverId}`

// Module-level constants so cache-miss fallbacks stay reference-stable across
// renders and selector runs (see useSharedCacheSelector's fallback discipline).
const CONNECTING_MCP_RUNTIME_STATUS: McpRuntimeStatus = { state: 'connecting', lastCheckedAt: 0 }
const DISABLED_MCP_RUNTIME_STATUS: McpRuntimeStatus = { state: 'disabled', lastCheckedAt: 0 }

export function getDefaultMcpRuntimeStatus(isActive: boolean): McpRuntimeStatus {
  return isActive ? CONNECTING_MCP_RUNTIME_STATUS : DISABLED_MCP_RUNTIME_STATUS
}

export function useMcpRuntimeStatus(serverId: string | undefined, isActive: boolean): McpRuntimeStatus {
  const key = serverId ? mcpStatusCacheKey(serverId) : mcpStatusCacheKey('__draft__')
  const cached = useSharedCacheValue(key)
  return cached ?? getDefaultMcpRuntimeStatus(isActive)
}

export function useMcpRuntimeStatusMap(
  servers: readonly { id: string; isActive: boolean }[]
): Record<string, McpRuntimeStatus> {
  const sortedServers = useMemo(() => [...servers].sort((a, b) => a.id.localeCompare(b.id)), [servers])

  const selector = useCallback(
    (values: readonly (McpRuntimeStatus | undefined)[]) =>
      Object.fromEntries(
        sortedServers.map((server, index): [string, McpRuntimeStatus] => [
          server.id,
          values[index] ?? getDefaultMcpRuntimeStatus(server.isActive)
        ])
      ),
    [sortedServers]
  )

  // Keys and the zip source both derive from `sortedServers` (zip-source
  // coherence); sorting keeps caller-side order drift from re-subscribing.
  return useSharedCacheSelector(
    sortedServers.map((server) => mcpStatusCacheKey(server.id)),
    selector
  )
}
