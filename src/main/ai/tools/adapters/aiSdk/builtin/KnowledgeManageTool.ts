/**
 * Knowledge base write tool — the destructive companion to the read tools.
 *
 * One tool with an `action`: add a new source (file / url / note), or delete /
 * re-index existing documents addressed by their Concept ID. The effective knowledge
 * base scope (the assistant's static binding when non-empty, else the composer's
 * per-turn selection — see `resolveKnowledgeBaseIds`) flows in via
 * `RequestContext.knowledgeBaseIds` and scopes which bases are reachable. Every
 * action mutates the base, so the tool is approval-gated
 * (`needsApproval: true`) — Cherry surfaces the approval card before it runs. The
 * mutation itself lives in the shared `knowledgeLookup` core so the Claude Code
 * MCP bridge runs identical logic (gated there by Claude Code's own permission
 * prompt); this file is just the AI-SDK `tool()` wrapper.
 *
 * `defer: 'never'` (kept inline, never behind `tool_search`/`tool_invoke`): the same rule
 * `mcp/mcpTools.ts` applies to force-prompt MCP tools. Deferring an approval-gated tool would strip
 * it from the SDK's tool-set, so the SDK's native `needsApproval` gate never fires and `tool_invoke`
 * refuses it too (it never runs an approval-gated tool blind) — an unreachable tool either way.
 */

import {
  KB_MANAGE_TOOL_NAME as SHARED_KB_MANAGE_TOOL_NAME,
  kbManageOutputSchema,
  kbManageStrictInputSchema
} from '@shared/ai/builtinTools'
import { toCherryClientToolName } from '@shared/ai/tools/cherryClientToolName'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import {
  KNOWLEDGE_MANAGE_DESCRIPTION,
  knowledgeLookupErrorSchema,
  knowledgeManageModelOutput,
  manageKnowledge
} from '../../../knowledgeLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export const KB_MANAGE_TOOL_NAME = toCherryClientToolName(SHARED_KB_MANAGE_TOOL_NAME)

// Mirror the read tools: an out-of-scope base / missing field / service error returns `{ error }`, so the output is a union.
const knowledgeManageResultSchema = z.union([kbManageOutputSchema, knowledgeLookupErrorSchema])

const kbManageTool = tool({
  description: KNOWLEDGE_MANAGE_DESCRIPTION,
  inputSchema: kbManageStrictInputSchema,
  outputSchema: knowledgeManageResultSchema,
  strict: true,
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
