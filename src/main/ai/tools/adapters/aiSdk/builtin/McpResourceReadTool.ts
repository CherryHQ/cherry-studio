/** Read published or conversation-embedded resources with bounded text pages and image delivery. */

import { type ToolResultOutput } from '@ai-sdk/provider-utils'
import { tool } from 'ai'

import { application } from '@application'
import { mcpToolResourceKey } from '@main/ai/messages/mcpToolResources'
import { isPathInside, openReadableFileSnapshot, realpath } from '@main/utils/file'
import {
  MCP_RESOURCE_READ_CHAR_CAP,
  MCP_RESOURCE_READ_TOOL_NAME,
  mcpResourceReadInputSchema,
  type McpResourceReadResult,
  mcpResourceReadResultSchema,
  type McpResourceSavedBlob
} from '@shared/ai/builtinTools'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { getToolCallContext, requestContextSchema, type RequestContext } from '../context'
import { isMcpResourceReadForcePrompt, resolveMcpResourceServers } from '../mcp/resolveAssistantMcpTools'
import { readScopedMcpResource } from '../mcp/scopedResources'
import type { ToolEntry } from '../types'

export const MCP_RESOURCE_READ_DESCRIPTION =
  'Read the content of an MCP resource. Pass the serverId and uri exactly as returned by ' +
  'mcp_resource_list, a resource the user attached, or an MCP tool result. Long resources come back one ' +
  'page at a time — continue with the returned nextOffset. Binary blobs are decoded to temporary ' +
  'files and returned as blobSavedTo paths, never as base64.'

async function readSavedImage(blob: McpResourceSavedBlob): Promise<string | null> {
  if (!blob.mimeType?.startsWith('image/')) return null

  const root = AbsoluteFilePathSchema.parse(application.getPath('feature.mcp.resource_results.temp'))
  const candidate = AbsoluteFilePathSchema.parse(blob.blobSavedTo)
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)])
  if (!isPathInside(realCandidate, realRoot)) return null

  const snapshot = await openReadableFileSnapshot(realCandidate)
  try {
    const chunks: Buffer[] = []
    for await (const chunk of snapshot.createReadStream()) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('base64')
  } finally {
    await snapshot.close()
  }
}

/** Keep the stored/UI result path-only while giving vision models the decoded image for this model step. */
export async function mcpResourceReadModelOutput(output: McpResourceReadResult): Promise<ToolResultOutput> {
  if ('error' in output) return { type: 'text', value: output.error }

  const images = await Promise.all(
    (output.blobs ?? []).map(async (blob) => {
      try {
        const data = await readSavedImage(blob)
        return data === null ? null : { type: 'image-data' as const, data, mediaType: blob.mimeType! }
      } catch {
        return null
      }
    })
  )
  const projectedImages = images.filter((image): image is NonNullable<typeof image> => image !== null)
  if (projectedImages.length === 0) return { type: 'json', value: output }

  return {
    type: 'content',
    value: [{ type: 'text', text: JSON.stringify(output) }, ...projectedImages]
  }
}

const mcpResourceReadTool = tool<
  { serverId: string; uri: string; offset?: number },
  McpResourceReadResult,
  RequestContext
>({
  contextSchema: requestContextSchema,
  description: MCP_RESOURCE_READ_DESCRIPTION,
  inputSchema: mcpResourceReadInputSchema,
  outputSchema: mcpResourceReadResultSchema,
  needsApproval: async (input, options) => {
    // Wildcard-gated servers prompt for every tool call; reading their resources must not be the one
    // silent path. The policy is read off the server this call addresses — one gated server must not
    // make reads from every other server prompt. Fail closed: no context, or a server the scope
    // cannot resolve, means prompt (the execute below rejects it anyway).
    try {
      const { request } = getToolCallContext(options)
      const { serverId, uri } = input as { serverId: string; uri: string }
      // Embedded bytes were already delivered by an authorized tool call; no server read occurs.
      if (request.mcpToolResources?.has(mcpToolResourceKey(serverId, uri))) return false
      const server = resolveMcpResourceServers(request.assistant, request.mcpResourceServerIds).find(
        (candidate) => candidate.id === (input as { serverId?: string }).serverId
      )
      return server ? isMcpResourceReadForcePrompt(server) : true
    } catch {
      return true
    }
  },
  toModelOutput: ({ output }) => mcpResourceReadModelOutput(output),
  execute: async ({ serverId, uri, offset }, options) => {
    const { request } = getToolCallContext(options)
    return readScopedMcpResource(resolveMcpResourceServers(request.assistant, request.mcpResourceServerIds), {
      serverId,
      uri,
      embeddedResources: request.mcpToolResources,
      offset,
      charCap: request.toolOutputCharCap ?? MCP_RESOURCE_READ_CHAR_CAP,
      signal: request.abortSignal
    })
  }
})

export function createMcpResourceReadToolEntry(): ToolEntry {
  return {
    name: MCP_RESOURCE_READ_TOOL_NAME,
    namespace: 'mcp_resource',
    description: 'Read one MCP resource by server id and uri',
    // Read-style tool: persisting its output would route the model straight back through it to read
    // the persisted file, same reasoning as fs_read / kb_read. It caps its own pages instead.
    truncatable: false,
    // Approval-gated entries must never defer: deferring removes the tool from the SDK tool-set, so
    // the native `needsApproval` gate never fires and it becomes reachable via `tool_invoke` with no
    // approval card (same rule as force-prompt MCP tools).
    defer: 'never',
    tool: mcpResourceReadTool,
    applies: (scope) => (scope.mcpResourceServerIds?.size ?? 0) > 0 || scope.mcpToolIds.size > 0
  }
}
