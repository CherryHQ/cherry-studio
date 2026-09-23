import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Tool as SDKTool } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'

import { loggerService } from '@logger'

const logger = loggerService.withContext('mcpListTools')
const toolObjectSchema = z
  .object({
    type: z.literal('object'),
    // JSON Schema 2020-12 allows boolean subschemas, empty objects and nested subschemas.
    properties: z.record(z.string(), z.unknown()).optional()
  })
  .loose()
const toolSchema = z
  .object({
    name: z.string().min(1),
    inputSchema: toolObjectSchema,
    outputSchema: toolObjectSchema.optional()
  })
  .loose()
const listToolsResultSchema = z.object({ tools: z.array(z.unknown()) }).loose()

export async function listToolsTolerant(client: Client): Promise<SDKTool[]> {
  const result = await client.request({ method: 'tools/list', params: {} }, listToolsResultSchema)
  const tools: SDKTool[] = []
  for (const [toolIndex, rawTool] of result.tools.entries()) {
    const parsed = toolSchema.safeParse(rawTool)
    if (!parsed.success) {
      logger.warn('Skipping invalid MCP tool', {
        toolIndex,
        toolName: typeof rawTool === 'object' && rawTool !== null && 'name' in rawTool ? rawTool.name : undefined,
        reason: parsed.error.message
      })
      continue
    }
    // SDKTool incorrectly restricts property subschemas to objects in its types too.
    tools.push(parsed.data as SDKTool)
  }
  // Preserve listTools()'s output-validation/task metadata cache; the SDK types this hook as private.
  const metadataClient = client as unknown as { cacheToolMetadata(tools: SDKTool[]): void }
  try {
    metadataClient.cacheToolMetadata(tools)
  } catch (error) {
    logger.warn('Failed to cache MCP tool metadata; checking tools individually', { reason: String(error) })
    const retainedTools = tools.filter((tool) => {
      try {
        metadataClient.cacheToolMetadata([tool])
        return true
      } catch (error) {
        logger.warn('Skipping invalid MCP tool', { toolName: tool.name, reason: String(error) })
        return false
      }
    })
    // Each probe clears all SDK caches; rebuild validators and task flags together.
    try {
      metadataClient.cacheToolMetadata(retainedTools)
    } catch (error) {
      logger.warn('Failed to cache MCP tool metadata; retaining validated tools', {
        toolCount: retainedTools.length,
        reason: String(error)
      })
    }
    return retainedTools
  }
  return tools
}
