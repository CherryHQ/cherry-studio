import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  CursorSchema,
  IconSchema,
  type Tool as SDKTool,
  ToolAnnotationsSchema,
  ToolExecutionSchema,
  ToolSchema as SDKToolSchema
} from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'

import { loggerService } from '@logger'

const logger = loggerService.withContext('mcpListTools')
// A JSON Schema subschema is a boolean or an object; anything else is protocol-invalid and skips the tool.
const subschema = z.union([z.boolean(), z.object({}).loose()])
const toolObjectSchema = z
  .object({
    type: z.literal('object'),
    properties: z.record(z.string(), subschema).optional()
  })
  .loose()
const toolSchema = SDKToolSchema.extend({
  inputSchema: toolObjectSchema,
  outputSchema: toolObjectSchema.optional(),
  annotations: ToolAnnotationsSchema.loose().optional(),
  execution: ToolExecutionSchema.loose().optional(),
  icons: z.array(IconSchema.loose()).optional()
}).loose()
const listToolsResultSchema = z.object({ tools: z.array(z.unknown()), nextCursor: CursorSchema.optional() }).loose()

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
    // An empty probe distinguishes an unsupported SDK hook from an invalid output schema.
    metadataClient.cacheToolMetadata([])
  } catch (error) {
    logger.warn('MCP tool metadata caching is unsupported; retaining accepted tools', { reason: String(error) })
    return tools
  }
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
