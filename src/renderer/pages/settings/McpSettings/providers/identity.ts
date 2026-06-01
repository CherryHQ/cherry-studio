import type { MCPServer } from '@shared/data/types/mcpServer'

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase()
  return trimmed || undefined
}

function sameStableValue(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalize(left)
  return normalizedLeft !== undefined && normalizedLeft === normalize(right)
}

function hasCompatibleProvider(left: MCPServer, right: MCPServer): boolean {
  const leftProvider = normalize(left.provider)
  const rightProvider = normalize(right.provider)
  return leftProvider === undefined || rightProvider === undefined || leftProvider === rightProvider
}

export function isSameMcpServerInstall(left: MCPServer, right: MCPServer): boolean {
  if (sameStableValue(left.id, right.id)) return true
  if (!hasCompatibleProvider(left, right)) return false

  return (
    sameStableValue(left.providerUrl, right.providerUrl) ||
    sameStableValue(left.baseUrl, right.baseUrl) ||
    sameStableValue(left.searchKey, right.searchKey)
  )
}
