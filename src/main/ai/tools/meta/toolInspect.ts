/**
 * `tool_inspect` meta-tool — emits a JSDoc stub for a single registered
 * tool, useful when the brief description from `tool_search` isn't enough
 * to call it confidently. The model can copy the stub straight into a
 * `tool_exec` body or read it as documentation before `tool_invoke`.
 *
 * Lifted from the legacy hub server (`mcpServers/hub/format.ts`); now
 * operates over the unified registry instead of MCP-only.
 */

import { type Tool, tool } from 'ai'
import * as z from 'zod'

import type { ToolRegistry } from '../registry'
import { schemaToJSDoc } from './formatJSDoc'

export const TOOL_INSPECT_TOOL_NAME = 'tool_inspect'

export function createToolInspectTool(registry: ToolRegistry): Tool {
  return tool({
    description:
      'Get a JSDoc stub for a registered tool — its description, parameter shapes, and a worked input example, ready to consult before `tool_invoke` or `tool_exec`.',
    inputSchema: z.object({
      name: z.string().describe('Tool name as returned by tool_search')
    }),
    inputExamples: [{ input: { name: 'fs__read' } }],
    execute: async ({ name }) => {
      const entry = registry.getByName(name)
      if (!entry) throw new Error(`Tool not found: ${name}`)
      const inputSchema = serializeSchema(entry.tool.inputSchema)
      // AI SDK's `Tool.inputExamples?: Array<{ input: INPUT }>` is the
      // canonical place for examples — surface the first one as a
      // `@example` block in the JSDoc stub.
      const firstExample = (entry.tool as { inputExamples?: Array<{ input: unknown }> }).inputExamples?.[0]?.input
      const exampleText = firstExample !== undefined ? JSON.stringify(firstExample, null, 2) : undefined
      return schemaToJSDoc(name, entry.description, inputSchema, exampleText)
    }
  })
}

function serializeSchema(schema: unknown): unknown {
  if (!schema) return undefined
  try {
    return JSON.parse(JSON.stringify(schema))
  } catch {
    return undefined
  }
}
