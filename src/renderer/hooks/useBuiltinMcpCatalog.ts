import { useCallback, useMemo, useRef, useState } from 'react'

import { toCreateMcpServerDto } from '@renderer/utils/mcpServerDraft'
import { PRESET_MCP_SERVERS, type McpServerPreset } from '@shared/data/presets/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { isBrowserMcpServer } from '@shared/utils/mcp'

import { useMcpServers } from './useMcpServer'

const presets = PRESET_MCP_SERVERS.filter((server) => !isBrowserMcpServer(server)).sort(
  (a, b) => Number(Boolean(a.shouldConfig)) - Number(Boolean(b.shouldConfig))
)

export function useBuiltinMcpCatalog() {
  const { mcpServers, addMcpServer, isLoading, error, refetch } = useMcpServers()
  const pending = useRef(new Map<string, Promise<McpServer>>())
  const [adding, setAdding] = useState<ReadonlySet<string>>(() => new Set())
  const findInstalled = useCallback(
    (preset: McpServerPreset) => mcpServers.find((server) => server.name === preset.name),
    [mcpServers]
  )
  const add = async (preset: McpServerPreset): Promise<McpServer> => {
    const existing = findInstalled(preset)
    if (existing) return existing
    const running = pending.current.get(preset.name)
    if (running) return running
    const task = addMcpServer(toCreateMcpServerDto(preset)).finally(() => {
      pending.current.delete(preset.name)
      setAdding(new Set(pending.current.keys()))
    })
    pending.current.set(preset.name, task)
    setAdding(new Set(pending.current.keys()))
    return task
  }
  // Featured: ready to use without configuration and not installed yet.
  const featured = useMemo(
    () => presets.filter((preset) => !preset.shouldConfig && !findInstalled(preset)),
    [findInstalled]
  )
  // Picked for a resource, so install it running; an inactive server would be bound but never used.
  const installFeatured = (preset: McpServerPreset) => add({ ...preset, isActive: true })
  return {
    presets,
    featured,
    mcpServers,
    findInstalled,
    add,
    installFeatured,
    adding,
    isLoading,
    error,
    retry: refetch
  }
}
