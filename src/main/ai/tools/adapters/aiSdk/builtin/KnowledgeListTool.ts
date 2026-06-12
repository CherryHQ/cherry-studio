/**
 * Knowledge base discovery tool — companion to `kb_search`.
 *
 * Returns metadata for the knowledge bases reachable from the current request,
 * with up to 8 sample item sources per base. The model uses this to pick which
 * `baseIds` to pass to `kb_search` instead of fanning out blindly. The listing
 * itself lives in the shared `knowledgeLookup` core so the Claude Code MCP bridge
 * runs identical logic; this file is just the AI-SDK `tool()` wrapper.
 *
 * Scope: when `assistant.knowledgeBaseIds` is non-empty, only those bases are
 * returned; when empty, all user bases are returned.
 */

import { KB_LIST_TOOL_NAME, kbListInputSchema, kbListOutputSchema } from '@shared/ai/builtinTools'
import { tool } from 'ai'
import * as z from 'zod'

import {
  KNOWLEDGE_LIST_DESCRIPTION,
  knowledgeListModelOutput,
  knowledgeLookupErrorSchema,
  listKnowledgeBases
} from '../../../knowledgeLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export { KB_LIST_TOOL_NAME }

// Mirror kb_search / the web tools: a listBases() infra failure returns `{ error }`, so the output is a union.
const knowledgeListResultSchema = z.union([kbListOutputSchema, knowledgeLookupErrorSchema])

const kbListTool = tool({
  description: KNOWLEDGE_LIST_DESCRIPTION,
  inputSchema: kbListInputSchema,
  outputSchema: knowledgeListResultSchema,
  strict: true,
  execute: async ({ query, groupId }, options) => {
    const { request } = getToolCallContext(options)
    return listKnowledgeBases(query, groupId, request.assistant?.knowledgeBaseIds ?? [])
  },
  toModelOutput: ({ input, output }) => knowledgeListModelOutput(output, input)
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
