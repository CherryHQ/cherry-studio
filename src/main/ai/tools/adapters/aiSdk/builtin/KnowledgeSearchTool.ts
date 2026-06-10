/**
 * Knowledge base search tool — agentic.
 *
 * The model picks the query and target `baseIds` (typically after `kb_list`).
 * Per-request `assistant.knowledgeBaseIds` flows in via RequestContext and
 * scopes which base IDs are accepted. The search itself lives in the shared
 * `kbLookup` core so the Claude Code MCP bridge runs identical logic; this
 * file is just the AI-SDK `tool()` wrapper.
 */

import { KB_SEARCH_TOOL_NAME, kbSearchInputSchema, kbSearchOutputSchema } from '@shared/ai/builtinTools'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'

import { KB_SEARCH_DESCRIPTION, kbSearchModelOutput, searchKb } from '../../../kb/kbLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export { KB_SEARCH_TOOL_NAME }

const kbSearchTool = tool({
  description: KB_SEARCH_DESCRIPTION,
  inputSchema: kbSearchInputSchema,
  outputSchema: kbSearchOutputSchema,
  strict: true,
  execute: async ({ query, baseIds }, options) => {
    const { request } = getToolCallContext(options)
    return searchKb(query, baseIds, request.assistant?.knowledgeBaseIds ?? [])
  },
  toModelOutput: ({ output }) => kbSearchModelOutput(output)
})

export function createKbSearchToolEntry(): ToolEntry {
  return {
    name: KB_SEARCH_TOOL_NAME,
    namespace: 'kb',
    description: "Search the user's private knowledge base",
    defer: 'auto',
    tool: kbSearchTool,
    applies: (scope) => (scope.assistant?.knowledgeBaseIds?.length ?? 0) > 0
  }
}

export type KnowledgeSearchToolInput = InferToolInput<typeof kbSearchTool>
export type KnowledgeSearchToolOutput = InferToolOutput<typeof kbSearchTool>
