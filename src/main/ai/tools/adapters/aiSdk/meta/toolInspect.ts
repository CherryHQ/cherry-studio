/**
 * `tool_inspect` meta-tool — emits a JSDoc stub for a single registered
 * tool, useful when the brief description from `tool_search` isn't enough
 * to call it confidently. The model can copy the stub straight into a
 * `tool_exec` body or read it as documentation before `tool_invoke`.
 */

import { asSchema, type Tool, tool } from 'ai'
import * as z from 'zod'

import type { ToolRegistry } from '../registry'
import { schemaToJSDoc } from './formatJsDoc'

export const TOOL_INSPECT_TOOL_NAME = 'tool_inspect'

/**
 * @param allowedNames per-request tool name set (see `createToolInvokeTool`). Scopes inspection to
 *   the tools this request exposed, so the model can't probe process-wide tools `applies()` excluded.
 */
export function createToolInspectTool(registry: ToolRegistry, allowedNames: ReadonlySet<string>): Tool {
  return tool({
    description:
      'Get a JSDoc stub for a registered tool — its description and parameter shapes, ready to consult before `tool_invoke` or `tool_exec`.',
    inputSchema: z.object({
      name: z.string().describe('Tool name as returned by tool_search')
    }),
    execute: async ({ name }) => {
      if (!allowedNames.has(name)) throw new Error(`Tool not available in this request: ${name}`)
      const entry = registry.getByName(name)
      if (!entry) throw new Error(`Tool not found: ${name}`)
      const inputSchema = await serializeSchema(entry.tool.inputSchema)
      return schemaToJSDoc(name, entry.description, inputSchema)
    }
  })
}

async function serializeSchema(schema: unknown): Promise<unknown> {
  if (!schema) return undefined
  // See toolSearch.ts: Zod / jsonSchema-wrapped / raw-JSONSchema all
  // normalise through `asSchema(...).jsonSchema`. Stringifying a Zod
  // object directly yields a non-JSONSchema blob.
  try {
    const normalised = asSchema(schema as Parameters<typeof asSchema>[0])
    return await normalised.jsonSchema
  } catch {
    return undefined
  }
}
