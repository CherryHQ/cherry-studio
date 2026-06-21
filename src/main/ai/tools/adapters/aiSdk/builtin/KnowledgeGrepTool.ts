/**
 * Knowledge base document grep tool — exact-match companion to `kb_search`.
 *
 * The model passes a `conceptId` + `baseId` from a `kb_search` hit plus a
 * regular expression to find exact text within that one document. Per-request
 * `assistant.knowledgeBaseIds` flows in via RequestContext and scopes which
 * bases are reachable. The grep itself lives in the shared `knowledgeLookup`
 * core so the Claude Code MCP bridge runs identical logic; this file is just the
 * AI-SDK `tool()` wrapper.
 */

import { KB_GREP_TOOL_NAME, kbGrepInputSchema, kbGrepOutputSchema } from '@shared/ai/builtinTools'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import {
  grepConcept,
  KNOWLEDGE_GREP_DESCRIPTION,
  knowledgeGrepModelOutput,
  knowledgeLookupErrorSchema
} from '../../../knowledgeLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export { KB_GREP_TOOL_NAME }

// Mirror kb_search: an out-of-scope base / unknown concept / invalid pattern returns `{ error }`, so the output is a union.
const knowledgeGrepResultSchema = z.union([kbGrepOutputSchema, knowledgeLookupErrorSchema])

const kbGrepTool = tool({
  description: KNOWLEDGE_GREP_DESCRIPTION,
  inputSchema: kbGrepInputSchema,
  outputSchema: knowledgeGrepResultSchema,
  strict: true,
  execute: async ({ baseId, conceptId, pattern, ignoreCase, maxMatches }, options) => {
    const { request } = getToolCallContext(options)
    return grepConcept(
      baseId,
      conceptId,
      { pattern, ignoreCase, maxMatches },
      request.assistant?.knowledgeBaseIds ?? []
    )
  },
  toModelOutput: ({ output }) => knowledgeGrepModelOutput(output)
})

export function createKbGrepToolEntry(): ToolEntry {
  return {
    name: KB_GREP_TOOL_NAME,
    namespace: 'kb',
    description: 'Find exact text (regex) inside a knowledge base document by its Concept ID',
    defer: 'auto',
    tool: kbGrepTool,
    applies: (scope) => (scope.assistant?.knowledgeBaseIds?.length ?? 0) > 0
  }
}

export type KnowledgeGrepToolInput = InferToolInput<typeof kbGrepTool>
export type KnowledgeGrepToolOutput = InferToolOutput<typeof kbGrepTool>
