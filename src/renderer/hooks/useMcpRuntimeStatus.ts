import { cacheService } from '@renderer/data/CacheService'
import { useSharedCache } from '@renderer/data/hooks/useCache'
import type { SharedCacheKey } from '@shared/data/cache/cacheSchemas'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import { useEffect, useMemo, useState } from 'react'

type McpStatusCacheKey = `mcp.status.${string}`

export const mcpStatusCacheKey = (serverId: string): McpStatusCacheKey => `mcp.status.${serverId}`

export function getDefaultMcpRuntimeStatus(isActive: boolean): McpRuntimeStatus {
  return { state: isActive ? 'connecting' : 'disabled', lastCheckedAt: 0 }
}

export function useMcpRuntimeStatus(serverId: string | undefined, isActive: boolean): McpRuntimeStatus {
  const key = serverId ? mcpStatusCacheKey(serverId) : mcpStatusCacheKey('__draft__')
  const [status] = useSharedCache(key, getDefaultMcpRuntimeStatus(isActive))
  return status
}

export function useMcpRuntimeStatusMap(
  servers: readonly { id: string; isActive: boolean }[]
): Record<string, McpRuntimeStatus> {
  const sortedServers = useMemo(() => [...servers].sort((a, b) => a.id.localeCompare(b.id)), [servers])
  const cacheKeys = useMemo(() => sortedServers.map((server) => mcpStatusCacheKey(server.id)), [sortedServers])

  const readSnapshot = () =>
    Object.fromEntries(
      sortedServers.map((server) => [
        server.id,
        cacheService.getShared(mcpStatusCacheKey(server.id) as SharedCacheKey) ??
          getDefaultMcpRuntimeStatus(server.isActive)
      ])
    ) as Record<string, McpRuntimeStatus>

  const [snapshot, setSnapshot] = useState<Record<string, McpRuntimeStatus>>(readSnapshot)

  useEffect(() => {
    setSnapshot(readSnapshot())
    const disposers = cacheKeys.map((key) => cacheService.subscribe(key, () => setSnapshot(readSnapshot())))
    return () => {
      disposers.forEach((dispose) => dispose())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKeys.join('|')])

  return snapshot
}
