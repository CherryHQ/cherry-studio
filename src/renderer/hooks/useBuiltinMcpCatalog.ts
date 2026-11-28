import { useCallback, useMemo, useRef, useState } from 'react'

import { useMutation } from '@data/hooks/useDataApi'
import { FEATURED_MCP_PRESETS, PRESET_MCP_SERVERS, type McpServerPreset } from '@shared/data/presets/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { isBrowserMcpServer } from '@shared/utils/mcp'

import { useMcpServers } from './useMcpServer'

const presets = PRESET_MCP_SERVERS.filter((server) => !isBrowserMcpServer(server)).sort(
  (a, b) => Number(Boolean(a.shouldConfig)) - Number(Boolean(b.shouldConfig))
)

export function useBuiltinMcpCatalog() {
  const { mcpServers, isLoading, error, refetch } = useMcpServers()
  const { trigger: installPreset } = useMutation('POST', '/mcp-servers/install-preset', { refresh: ['/mcp-servers'] })
  const pending = useRef(new Map<string, Promise<McpServer>>())
  const [adding, setAdding] = useState<ReadonlySet<string>>(() => new Set())
  const findInstalled = useCallback(
    (preset: McpServerPreset) =>
      mcpServers.find((server) => server.name === preset.name && server.installSource === 'builtin'),
    [mcpServers]
  )
  const install = (preset: McpServerPreset, activate: boolean): Promise<McpServer> => {
    const running = pending.current.get(preset.name)
    if (running) return running
    const task = installPreset({ body: { name: preset.name, activate } }).finally(() => {
      pending.current.delete(preset.name)
      setAdding(new Set(pending.current.keys()))
    })
    pending.current.set(preset.name, task)
    setAdding(new Set(pending.current.keys()))
    return task
  }
  // Featured: ready to use without configuration and not installed yet.
  const featured = useMemo(() => FEATURED_MCP_PRESETS.filter((preset) => !findInstalled(preset)), [findInstalled])
  return {
    presets,
    featured,
    mcpServers,
    findInstalled,
    add: (preset: McpServerPreset) => install(preset, false),
    installFeatured: (preset: McpServerPreset) => install(preset, true),
    adding,
    isLoading,
    error,
    retry: refetch
  }
}
