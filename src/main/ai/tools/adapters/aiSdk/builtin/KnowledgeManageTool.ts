/**
 * Knowledge base write tool — the destructive companion to the read tools.
 *
 * One tool with an `action`: add a new source (file / url / note), or delete /
 * re-index existing documents addressed by their Concept ID. The effective knowledge
 * base scope (the assistant's static binding narrowed by the composer's per-turn
 * selection, or that selection alone when there is no binding — see
 * `resolveKnowledgeBaseScope`) flows in via
 * `RequestContext.knowledgeBaseIds` and scopes which bases are reachable. Every
 * action mutates the base, so the tool is approval-gated
 * (`needsApproval: true`) — Cherry surfaces the approval card before it runs. The
 * mutation itself lives in the shared `knowledgeLookup` core so the Claude Code
 * MCP bridge runs identical logic (gated there by Claude Code's own permission
 * prompt); this file is just the AI-SDK `tool()` wrapper.
 *
 * `defer: 'never'` keeps mutations inline on the direct path with a persisted approval card,
 * matching force-prompt MCP tools in `mcp/mcpTools.ts`.
 */

import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import { KB_MANAGE_TOOL_NAME, kbManageInputSchema, kbManageOutputSchema } from '@shared/ai/builtinTools'

import {
  KNOWLEDGE_MANAGE_DESCRIPTION,
  knowledgeLookupErrorSchema,
  knowledgeManageModelOutput,
  manageKnowledge
} from '../../../knowledgeLookup'
import { getToolCallContext, requestContextSchema } from '../context'
import type { ToolEntry } from '../types'

export { KB_MANAGE_TOOL_NAME }

// Mirror the read tools: an out-of-scope base / missing field / service error returns `{ error }`, so the output is a union.
const knowledgeManageResultSchema = z.union([kbManageOutputSchema, knowledgeLookupErrorSchema])

const kbManageTool = tool({
  contextSchema: requestContextSchema,
  description: KNOWLEDGE_MANAGE_DESCRIPTION,
  inputSchema: kbManageInputSchema,
  outputSchema: knowledgeManageResultSchema,
  // Every action (add / delete / refresh) modifies the base; gate on explicit user approval.
  needsApproval: true,
  execute: async (input, options) => {
    const { request } = getToolCallContext(options)
    return manageKnowledge(input, request.knowledgeBaseIds ?? [])
  },
  toModelOutput: ({ output }) => knowledgeManageModelOutput(output)
})

export function createKbManageToolEntry(): ToolEntry {
  return {
    name: KB_MANAGE_TOOL_NAME,
    namespace: 'kb',
    description: 'Add, delete, or re-index documents in a knowledge base (requires approval)',
    defer: 'never',
    tool: kbManageTool,
    applies: (scope) => scope.hasAnyKnowledgeBase === true && (scope.knowledgeBaseIds?.length ?? 0) > 0
  }
}

export type KnowledgeManageToolInput = InferToolInput<typeof kbManageTool>
export type KnowledgeManageToolOutput = InferToolOutput<typeof kbManageTool>
