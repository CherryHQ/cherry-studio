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
import { serializeToolSchema } from './schemaStub'

export const TOOL_SEARCH_TOOL_NAME = 'tool_search'

export function createToolSearchTool(
  registry: ToolRegistry,
  deferredNames: ReadonlySet<string>,
  inspectedNames: Set<string>
): Tool {
  return tool({
    description:
      'Discover available tools by namespace. This is tool discovery (NOT web search). Tools are ' +
      'grouped by domain (web, kb, mcp:gmail, ...). Omit `query` to browse all. Inspect a name ' +
      'returned here with `tool_inspect`, then call it with `tool_invoke`.',
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
    inputExamples: [{ input: { query: 'gmail', verbose: false } }, { input: { namespace: 'web', verbose: true } }],
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
          filtered.map(async (e) => {
            if (!verbose) return { name: e.name, description: e.description }
            // Verbose search shows the model each tool's full input schema, so it has "seen" the
            // signature — record it in the shared ledger exactly as `tool_inspect` would, so the
            // first `tool_invoke` isn't bounced by Guard A (the deferred-tools prompt promises this).
            // Only record when the schema actually serialized: a tool whose schema failed (undefined)
            // wasn't really shown, so it must still be bounced on first invoke.
            const inputSchema = await serializeToolSchema(e.tool.inputSchema)
            if (inputSchema !== undefined) inspectedNames.add(e.name)
            return {
              name: e.name,
              description: e.description,
              inputSchema
            }
          })
        )
        matchedNamespaces.push({ namespace: ns, tools })
      }
      return { matchedNamespaces }
    },
    // Render the catalog as a compact namespace listing instead of nested JSON — fewer tokens and
    // easier for the model to scan tool names. Names are verbatim so they can be passed to
    // `tool_inspect` / `tool_invoke` as-is.
    toModelOutput: ({ output }) => ({ type: 'text', value: formatSearchForModel(output) })
  })
}

function formatSearchForModel(output: {
  matchedNamespaces: Array<{
    namespace: string
    tools: Array<{ name: string; description: string; inputSchema?: unknown }>
  }>
}): string {
  if (output.matchedNamespaces.length === 0) {
    return 'No tools matched. Broaden `query`, or omit it to browse all namespaces.'
  }
  const lines: string[] = []
  for (const group of output.matchedNamespaces) {
    lines.push(group.namespace)
    for (const t of group.tools) {
      lines.push(`  - ${t.name} — ${t.description}`)
      if (t.inputSchema !== undefined) lines.push(`    input: ${JSON.stringify(t.inputSchema)}`)
    }
  }
  return lines.join('\n')
}
