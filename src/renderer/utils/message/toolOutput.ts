/** Unwrap application payloads while preserving MCP result/error envelopes for every consumer. */

import { isMcpContentBlock } from '@shared/utils/mcp'

export type ToolType = 'mcp' | 'builtin' | 'provider'

export type ToolMetadata = {
  description?: string
  name?: string
  serverId?: string
  serverName?: string
  type?: ToolType
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isToolType(value: unknown): value is ToolType {
  return value === 'mcp' || value === 'builtin' || value === 'provider'
}

function isMcpContentArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.every(isMcpContentBlock)
}

export function extractOutputMetadata(output: unknown): { response: unknown; metadata?: ToolMetadata } {
  if (!isRecord(output)) return { response: output }

  const metadata = isRecord(output.metadata) ? output.metadata : undefined
  if ('content' in output || metadata) {
    const normalizedMeta: ToolMetadata | undefined = metadata
      ? {
          description: typeof metadata.description === 'string' ? metadata.description : undefined,
          name: typeof metadata.name === 'string' ? metadata.name : undefined,
          serverId: typeof metadata.serverId === 'string' ? metadata.serverId : undefined,
          serverName: typeof metadata.serverName === 'string' ? metadata.serverName : undefined,
          type: isToolType(metadata.type) ? metadata.type : undefined
        }
      : undefined
    const response = isMcpContentArray(output.content) || output.isError === true ? output : output.content
    return { response, metadata: normalizedMeta }
  }

  return { response: output }
}

export function normalizeToolOutputResponse(output: unknown): unknown {
  return extractOutputMetadata(output).response
}
