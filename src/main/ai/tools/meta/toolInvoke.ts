/**
 * `tool_invoke` meta-tool — dispatches a tool by name through the registry.
 * The LLM uses this together with `tool_search`: search to discover, invoke
 * to call.
 *
 * Forwards the AI SDK execution options (messages, abortSignal,
 * experimental_context) onto the inner tool's `execute` so the per-request
 * RequestContext flows through. The inner `toolCallId` is suffixed with the
 * target name so telemetry can rebuild the call tree.
 */

import { type Tool, tool } from 'ai'
import * as z from 'zod'

import type { ToolRegistry } from '../registry'

export const TOOL_INVOKE_TOOL_NAME = 'tool_invoke'

const toolInvokeInputSchema = z.object({
  name: z.string().describe('Tool name as returned by tool_search'),
  params: z.record(z.string(), z.unknown()).optional().describe('Tool input arguments')
})

export function createToolInvokeTool(registry: ToolRegistry): Tool {
  return tool({
    description:
      'Call a tool discovered via `tool_search` by name. Pass arguments under `params` matching the tool input schema.',
    inputSchema: toolInvokeInputSchema,
    inputExamples: [
      {
        input: {
          name: 'fs__read',
          params: { path: '/Users/me/project/src/index.ts' }
        } as z.infer<typeof toolInvokeInputSchema>
      }
    ],
    execute: async ({ name, params }, options) => {
      const entry = registry.getByName(name)
      if (!entry) throw new Error(`Tool not found: ${name}`)
      if (typeof entry.tool.execute !== 'function') {
        throw new Error(`Tool ${name} has no execute handler`)
      }
      return entry.tool.execute(params ?? {}, {
        ...options,
        toolCallId: `${options.toolCallId}::${name}`
      })
    }
  })
}
