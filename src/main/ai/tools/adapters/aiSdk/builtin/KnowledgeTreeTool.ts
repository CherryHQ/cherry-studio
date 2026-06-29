/**
 * Knowledge base outline tool — structure companion to `kb_search`.
 *
 * Returns a base's organization tree (folders + documents) so the model can
 * browse what a base contains and pick a document's `conceptId` for kb_read /
 * kb_grep. Per-request `assistant.knowledgeBaseIds` flows in via RequestContext
 * and scopes which bases are reachable. The traversal lives in the shared
 * `knowledgeLookup` core so the Claude Code MCP bridge runs identical logic;
 * this file is just the AI-SDK `tool()` wrapper.
 */

import { KB_TREE_TOOL_NAME, kbTreeInputSchema, kbTreeOutputSchema } from '@shared/ai/builtinTools'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import {
  KNOWLEDGE_TREE_DESCRIPTION,
  knowledgeLookupErrorSchema,
  knowledgeTreeModelOutput,
  readTree
} from '../../../knowledgeLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export { KB_TREE_TOOL_NAME }

// Mirror kb_search: an out-of-scope or missing base returns `{ error }`, so the output is a union.
const knowledgeTreeResultSchema = z.union([kbTreeOutputSchema, knowledgeLookupErrorSchema])

const kbTreeTool = tool({
  description: KNOWLEDGE_TREE_DESCRIPTION,
  inputSchema: kbTreeInputSchema,
  outputSchema: knowledgeTreeResultSchema,
  strict: true,
  execute: async ({ baseId, maxDepth }, options) => {
    const { request } = getToolCallContext(options)
    return readTree(baseId, { maxDepth }, request.assistant?.knowledgeBaseIds ?? [])
  },
  toModelOutput: ({ output }) => knowledgeTreeModelOutput(output)
})

export function createKbTreeToolEntry(): ToolEntry {
  return {
    name: KB_TREE_TOOL_NAME,
    namespace: 'kb',
    description: "Outline a knowledge base's folders and documents",
    defer: 'always',
    tool: kbTreeTool,
    applies: (scope) => (scope.assistant?.knowledgeBaseIds?.length ?? 0) > 0
  }
}

export type KnowledgeTreeToolInput = InferToolInput<typeof kbTreeTool>
export type KnowledgeTreeToolOutput = InferToolOutput<typeof kbTreeTool>
