/**
 * Knowledge base browse tool — companion to `kb_search`.
 *
 * Two modes, selected by `baseId`:
 *   - omit `baseId` → list the bases reachable from the current request, with up to 8 sample item
 *     sources each, so the model can pick which `baseIds` to pass to `kb_search`.
 *   - pass `baseId` → outline that one base's folder/document structure, surfacing each readable
 *     document's `conceptId` for `kb_read`.
 *
 * Both modes live in the shared `knowledgeLookup` core so the Claude Code MCP bridge runs identical
 * logic; this file is just the AI-SDK `tool()` wrapper.
 *
 * Scope: when `assistant.knowledgeBaseIds` is non-empty, only those bases are reachable; when empty,
 * all user bases are.
 */

import {
  KB_LIST_TOOL_NAME,
  kbListOutputSchema,
  kbListStrictInputSchema,
  kbTreeOutputSchema
} from '@shared/ai/builtinTools'
import { tool } from 'ai'
import * as z from 'zod'

import {
  KNOWLEDGE_LIST_DESCRIPTION,
  knowledgeListModelOutput,
  knowledgeLookupErrorSchema,
  listOrOutlineKnowledge
} from '../../../knowledgeLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export { KB_LIST_TOOL_NAME }

// Two modes: list the bases (array) or outline one base (tree object). An infra failure returns
// `{ error }`, so the output is a three-way union.
const knowledgeListResultSchema = z.union([kbListOutputSchema, kbTreeOutputSchema, knowledgeLookupErrorSchema])

const kbListTool = tool({
  description: KNOWLEDGE_LIST_DESCRIPTION,
  inputSchema: kbListStrictInputSchema,
  outputSchema: knowledgeListResultSchema,
  strict: true,
  execute: async (input, options) => {
    const { request } = getToolCallContext(options)
    return listOrOutlineKnowledge(input, request.assistant?.knowledgeBaseIds ?? [])
  },
  toModelOutput: ({ input, output }) => knowledgeListModelOutput(output, input)
})

export function createKbListToolEntry(): ToolEntry {
  return {
    name: KB_LIST_TOOL_NAME,
    namespace: 'kb',
    description: "List the user's knowledge bases, or outline one base's structure",
    defer: 'never',
    tool: kbListTool,
    // Discovery entry point, always inlined (defer: 'never') — but gated identically to kb_search /
    // kb_read / kb_manage: a base must exist AND be bound to this assistant. Listing every base while
    // none are bound (no kb_read / kb_search to act on them) is a discovery dead-end and widens the
    // per-assistant scope, so kb_list shares the siblings' gate.
    applies: (scope) => scope.hasAnyKnowledgeBase === true && (scope.assistant?.knowledgeBaseIds?.length ?? 0) > 0
  }
}
