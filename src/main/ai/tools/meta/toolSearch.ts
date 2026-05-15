/**
 * `tool_search` meta-tool — exposes the deferred-tool catalog to the LLM
 * by namespace. Constructed per request so it can close over the deferred
 * name set; not registered in the long-lived ToolRegistry.
 *
 * Surfaces ONLY deferred entries — tools that are already inline in the
 * request's ToolSet would be redundant in search results.
 */

import { asSchema, type Tool, tool } from 'ai'
import * as z from 'zod'

import type { ToolRegistry } from '../registry'

export const TOOL_SEARCH_TOOL_NAME = 'tool_search'

export function createToolSearchTool(registry: ToolRegistry, deferredNames: ReadonlySet<string>): Tool {
  return tool({
    description:
      'Discover available tools by namespace. Tools are grouped by domain (web, kb, mcp:gmail, ...). ' +
      'Omit `query` to browse all. Use the names returned here with `tool_invoke`.',
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe('Substring match against tool name, description, and namespace (case-insensitive)'),
      namespace: z.string().optional().describe('Restrict the result to a single namespace'),
      verbose: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include each tool full input schema in the result (more tokens)')
    }),
    execute: async ({ query, namespace, verbose }) => {
      const grouped = registry.getByNamespace({ query, namespace })
      const matchedNamespaces: Array<{
        namespace: string
        tools: Array<{ name: string; description: string; inputSchema?: unknown }>
      }> = []

      for (const [ns, entries] of grouped) {
        const filtered = entries.filter((e) => deferredNames.has(e.name))
        if (filtered.length === 0) continue
        const tools = await Promise.all(
          filtered.map(async (e) => ({
            name: e.name,
            description: e.description,
            ...(verbose ? { inputSchema: await serializeSchema(e.tool.inputSchema) } : {})
          }))
        )
        matchedNamespaces.push({ namespace: ns, tools })
      }
      return { matchedNamespaces }
    }
  })
}

async function serializeSchema(schema: unknown): Promise<unknown> {
  if (!schema) return undefined
  if (typeof schema === 'object' && schema !== null && 'type' in schema) return schema
  // Tools can carry Zod, jsonSchema wrappers, or raw JSONSchema. AI SDK's
  // `asSchema` normalises all three into the canonical `Schema<T>` shape
  // whose `.jsonSchema` is what the model actually sees inline. Stringifying
  // a raw Zod object yields a non-JSONSchema blob.
  try {
    const normalised = asSchema(schema as Parameters<typeof asSchema>[0])
    return await normalised.jsonSchema
  } catch {
    return undefined
  }
}
