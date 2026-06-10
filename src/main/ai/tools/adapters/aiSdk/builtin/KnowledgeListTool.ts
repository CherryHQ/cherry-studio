/**
 * Knowledge base discovery tool — companion to `kb_search`.
 *
 * Returns metadata for the knowledge bases reachable from the current request,
 * with up to 8 sample item sources per base. The model uses this to pick which
 * `baseIds` to pass to `kb_search` instead of fanning out blindly. The listing
 * itself lives in the shared `kbLookup` core so the Claude Code MCP bridge runs
 * identical logic; this file is just the AI-SDK `tool()` wrapper.
 *
 * Scope: when `assistant.knowledgeBaseIds` is non-empty, only those bases are
 * returned; when empty, all user bases are returned.
 */

import { KB_LIST_TOOL_NAME, kbListInputSchema, kbListOutputSchema } from '@shared/ai/builtinTools'
import { tool } from 'ai'

import { KB_LIST_DESCRIPTION, kbListModelOutput, listKb } from '../../../kb/kbLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export { KB_LIST_TOOL_NAME }

const kbListTool = tool({
  description: KB_LIST_DESCRIPTION,
  inputSchema: kbListInputSchema,
  outputSchema: kbListOutputSchema,
  strict: true,
  execute: async ({ query, groupId }, options) => {
    const { request } = getToolCallContext(options)
    return listKb(query, groupId, request.assistant?.knowledgeBaseIds ?? [])
  },
  toModelOutput: ({ input, output }) => kbListModelOutput(output, input)
})

export function createKbListToolEntry(): ToolEntry {
  return {
    name: KB_LIST_TOOL_NAME,
    namespace: 'kb',
    description: "List the user's available knowledge bases with sample sources",
    defer: 'auto',
    tool: kbListTool,
    applies: (scope) => (scope.assistant?.knowledgeBaseIds?.length ?? 0) > 0
  }
}
