/**
 * `tool_search` meta-tool — exposes the deferred-tool catalog to the LLM
 * by namespace. Constructed per request so it can close over the deferred
 * name set; not registered in the long-lived ToolRegistry.
 *
 * Surfaces ONLY deferred entries — tools that are already inline in the
 * request's ToolSet would be redundant in search results.
 */

import { type Tool, tool } from 'ai'
import * as z from 'zod'

import type { ToolRegistry } from '../registry'

export const TOOL_SEARCH_TOOL_NAME = 'tool_search'

const toolSearchInputSchema = z.object({
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
})

export function createToolSearchTool(registry: ToolRegistry, deferredNames: ReadonlySet<string>): Tool {
  return tool({
    description:
      'Discover available tools by namespace. Tools are grouped by domain (web, kb, mcp:gmail, ...). ' +
      'Omit `query` to browse all. Use the names returned here with `tool_invoke`.',
    inputSchema: toolSearchInputSchema,
    inputExamples: [
      { input: {} as z.infer<typeof toolSearchInputSchema> },
      { input: { namespace: 'fs' } as z.infer<typeof toolSearchInputSchema> },
      { input: { query: 'search', verbose: true } as z.infer<typeof toolSearchInputSchema> }
    ],
    execute: async ({ query, namespace, verbose }) => {
      const grouped = registry.getByNamespace({ query, namespace })
      const matchedNamespaces: Array<{
        namespace: string
        tools: Array<{
          name: string
          description: string
          inputExamples?: ReadonlyArray<{ input: unknown }>
          inputSchema?: unknown
        }>
      }> = []

      for (const [ns, entries] of grouped) {
        const filtered = entries.filter((e) => deferredNames.has(e.name))
        if (filtered.length === 0) continue
        matchedNamespaces.push({
          namespace: ns,
          tools: filtered.map((e) => {
            const inputExamples = (e.tool as { inputExamples?: ReadonlyArray<{ input: unknown }> }).inputExamples
            return {
              name: e.name,
              description: e.description,
              // Always surface examples — short, and the model needs them
              // to call the tool correctly. Schemas stay gated behind
              // `verbose` because they're much larger.
              ...(inputExamples && inputExamples.length > 0 ? { inputExamples } : {}),
              ...(verbose ? { inputSchema: serializeSchema(e.tool.inputSchema) } : {})
            }
          })
        })
      }
      return { matchedNamespaces }
    }
  })
}

function serializeSchema(schema: unknown): unknown {
  if (!schema) return undefined
  // Best-effort serialisation — different Tool implementations carry zod,
  // jsonSchema wrappers, or raw JSON Schema. Fall back to undefined when
  // the value isn't structured-cloneable.
  try {
    return JSON.parse(JSON.stringify(schema))
  } catch {
    return undefined
  }
}
