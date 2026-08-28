import type { McpToolBinding } from '@shared/ai/tools/mcpToolIdentity'

import { buildMcpToolIdentityKey, buildMcpToolRuntimeName, buildMcpToolWireName } from '../mcp/mcpToolId'

export type McpToolBindingInput = {
  serverId: string
  serverWireName: string
  originalToolName: string
}

export function createMcpToolBinding({
  serverId,
  serverWireName,
  originalToolName
}: McpToolBindingInput): McpToolBinding {
  const identityKey = buildMcpToolIdentityKey({ serverId, toolName: originalToolName })
  const toolWireName = buildMcpToolWireName({ serverId, toolName: originalToolName })
  const runtimeName = buildMcpToolRuntimeName({ serverId, serverWireName, toolName: originalToolName })

  return Object.freeze({
    identityKey,
    runtimeName,
    serverId,
    serverWireName,
    toolWireName,
    originalToolName
  })
}

export interface McpToolBindingSnapshot {
  readonly version: number
  readonly bindings: readonly McpToolBinding[]
  lookupRuntimeName(runtimeName: string): McpToolBinding | undefined
  lookupServerTool(serverWireName: string, toolWireName: string): McpToolBinding | undefined
}

export class McpToolBindingCollisionError extends Error {
  constructor(runtimeName: string) {
    super(`Duplicate MCP runtime name: ${runtimeName}`)
    this.name = 'McpToolBindingCollisionError'
  }
}

export function createMcpToolBindingSnapshot(
  bindings: readonly McpToolBinding[] = [],
  version = 0
): McpToolBindingSnapshot {
  const byRuntimeName = new Map<string, McpToolBinding>()
  const byServerTool = new Map<string, McpToolBinding>()

  for (const binding of bindings) {
    if (byRuntimeName.has(binding.runtimeName)) {
      throw new McpToolBindingCollisionError(binding.runtimeName)
    }
    const serverToolKey = `${binding.serverWireName}\0${binding.toolWireName}`
    if (byServerTool.has(serverToolKey)) {
      throw new McpToolBindingCollisionError(`${binding.serverWireName}__${binding.toolWireName}`)
    }
    byRuntimeName.set(binding.runtimeName, binding)
    byServerTool.set(serverToolKey, binding)
  }

  const snapshot: McpToolBindingSnapshot = {
    version,
    bindings: Object.freeze([...bindings]),
    lookupRuntimeName: (runtimeName) => byRuntimeName.get(runtimeName),
    lookupServerTool: (serverWireName, toolWireName) => byServerTool.get(`${serverWireName}\0${toolWireName}`)
  }
  return Object.freeze(snapshot)
}

export class McpToolBindingStore {
  private snapshot: McpToolBindingSnapshot = createMcpToolBindingSnapshot()
  private disposed = false
  private latestRefreshToken = 0

  getSnapshot(): McpToolBindingSnapshot {
    return this.snapshot
  }

  replaceSnapshotIfCurrent(refreshToken: number, bindings: readonly McpToolBinding[]): boolean {
    if (this.disposed || refreshToken <= this.latestRefreshToken) return false
    const next = createMcpToolBindingSnapshot(bindings, refreshToken)
    this.latestRefreshToken = refreshToken
    this.snapshot = next
    return true
  }

  dispose(): void {
    this.disposed = true
  }
}
