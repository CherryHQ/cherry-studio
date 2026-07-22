/**
 * `tool_inspect` meta-tool — emits a JSDoc stub for a single registered
 * tool: its description and parameter shapes. Optional — `tool_invoke`
 * returns the same signature when called on an unseen tool — but inspecting
 * first lets the model confirm parameters without a guess-and-retry round-trip.
 */

import { WEB_SEARCH_TOOL_NAME as SHARED_WEB_SEARCH_TOOL_NAME } from '@shared/ai/builtinTools'
import {
  CHERRY_TOOL_INSPECT_TOOL_NAME,
  CHERRY_TOOL_INVOKE_TOOL_NAME,
  CHERRY_TOOL_SEARCH_TOOL_NAME,
  toCherryClientToolName
} from '@shared/ai/tools/cherryClientToolName'
import { type Tool, tool } from 'ai'
import * as z from 'zod'

import type { ToolRegistry } from '../registry'
import { buildToolStub } from './schemaStub'

export const TOOL_INSPECT_TOOL_NAME = CHERRY_TOOL_INSPECT_TOOL_NAME
const EXAMPLE_WEB_SEARCH_TOOL_NAME = toCherryClientToolName(SHARED_WEB_SEARCH_TOOL_NAME)

/**
 * @param allowedNames per-request tool name set (see `createToolInvokeTool`). Scopes inspection to
 *   the tools this request exposed, so the model can't probe process-wide tools `applies()` excluded.
 * @param inspectedNames shared per-request set of tools whose signature the model has been shown.
 *   `tool_invoke` reads it as its unseen-schema guard; a successful inspect records the name.
 */
export function createToolInspectTool(
  registry: ToolRegistry,
  allowedNames: ReadonlySet<string>,
  inspectedNames: Set<string>
): Tool {
  return tool({
    description:
      'Get a single tool signature as a JSDoc stub — its description and parameter shapes. ' +
      `Use it before \`${CHERRY_TOOL_INVOKE_TOOL_NAME}\` to confirm parameter names and shapes and avoid a guess-and-retry.`,
    inputSchema: z.object({
      name: z.string().describe(`Tool name as returned by ${CHERRY_TOOL_SEARCH_TOOL_NAME}`)
    }),
    inputExamples: [{ input: { name: EXAMPLE_WEB_SEARCH_TOOL_NAME } }],
    execute: async ({ name }) => {
      if (!allowedNames.has(name)) throw new Error(`Tool not available in this request: ${name}`)
      const entry = registry.getByName(name)
      if (!entry) throw new Error(`Tool not found: ${name}`)
      const stub = await buildToolStub(entry)
      inspectedNames.add(name)
      return stub
    },
    // The stub is documentation, not data — hand it to the model as plain text instead of a
    // JSON-quoted string so it reads as the signature it is.
    toModelOutput: ({ output }) => ({ type: 'text', value: output })
  })
}
