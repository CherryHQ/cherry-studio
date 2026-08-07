import { createHash } from 'node:crypto'

import { toCamelCase } from '@shared/ai/tools/mcpToolName'

const MCP_TOOL_ID_MAX_LENGTH = 63
const IDENTITY_DIGEST_LENGTH = 20

export type McpToolWireIdInput = {
  serverId: string
  serverName: string
  toolName: string
}

export function buildMcpToolWireId({ serverId, serverName, toolName }: McpToolWireIdInput): string {
  const serverPart = toCamelCase(serverName) || 'server'
  const toolPart = toCamelCase(toolName) || 'tool'
  const digest = createHash('sha256')
    .update(serverId)
    .update('\0')
    .update(toolName)
    .digest('hex')
    .slice(0, IDENTITY_DIGEST_LENGTH)
  const suffix = `_${digest}`
  const body = `mcp__${serverPart}__${toolPart}`.slice(0, MCP_TOOL_ID_MAX_LENGTH - suffix.length).replace(/_+$/, '')

  return `${body}${suffix}`
}
