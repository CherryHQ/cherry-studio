/**
 * Knowledge base search tool — agentic.
 *
 * The model picks the query and target `baseIds` (typically after `kb_list`).
 * Per-request `assistant.knowledgeBaseIds` flows in via RequestContext and
 * scopes which base IDs are accepted. The search itself lives in the shared
 * `knowledgeLookup` core so the Claude Code MCP bridge runs identical logic;
 * this file is just the AI-SDK `tool()` wrapper.
 */

import { KB_SEARCH_TOOL_NAME, kbSearchInputSchema, kbSearchOutputSchema } from '@shared/ai/builtinTools'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import {
  KNOWLEDGE_SEARCH_DESCRIPTION,
  knowledgeLookupErrorSchema,
  knowledgeSearchModelOutput,
  searchKnowledge
} from '../../../knowledgeLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export { KB_SEARCH_TOOL_NAME }

// Mirror the web tool: an all-bases-failed lookup returns `{ error }`, so the output is a union.
const knowledgeSearchResultSchema = z.union([kbSearchOutputSchema, knowledgeLookupErrorSchema])

const kbSearchTool = tool({
  description: KNOWLEDGE_SEARCH_DESCRIPTION,
  inputSchema: kbSearchInputSchema,
  outputSchema: knowledgeSearchResultSchema,
  strict: true,
  execute: async ({ query, baseIds }, options) => {
    const { request } = getToolCallContext(options)
    return searchKnowledge(query, baseIds, request.assistant?.knowledgeBaseIds ?? [])
  },
  toModelOutput: ({ output }) => knowledgeSearchModelOutput(output)
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
