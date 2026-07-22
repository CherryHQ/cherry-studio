/**
 * Knowledge base document read tool — deep-read companion to `kb_search`.
 *
 * Two modes, selected by `pattern`:
 *   - omit `pattern` → read the full source document (or a slice) behind a `kb_search` hit, so the
 *     model can quote it accurately and read surrounding context.
 *   - pass `pattern` → grep within that one document for an exact regular expression, returning each
 *     match's line, offsets, and snippet — for a precise lookup when semantic search is too fuzzy.
 *
 * The model passes a `conceptId` + `baseId` from a `kb_search` hit (or a `kb_list` outline).
 * The effective knowledge base scope (the assistant's static binding when non-empty, else the
 * composer's per-turn selection — see `resolveKnowledgeBaseIds`) flows in via
 * `RequestContext.knowledgeBaseIds` and scopes which bases are reachable. Both modes live in the
 * shared `knowledgeLookup` core so the Claude Code MCP bridge runs
 * identical logic; this file is just the AI-SDK `tool()` wrapper.
 */

import {
  KB_READ_TOOL_NAME as SHARED_KB_READ_TOOL_NAME,
  kbGrepOutputSchema,
  kbReadInputSchema,
  kbReadOutputSchema
} from '@shared/ai/builtinTools'
import { toCherryClientToolName } from '@shared/ai/tools/cherryClientToolName'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import {
  KNOWLEDGE_READ_DESCRIPTION,
  knowledgeLookupErrorSchema,
  knowledgeReadModelOutput,
  readOrGrepConcept
} from '../../../knowledgeLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export const KB_READ_TOOL_NAME = toCherryClientToolName(SHARED_KB_READ_TOOL_NAME)

// Two modes: read the document text or grep it for `pattern`. An out-of-scope base / unknown concept
// / invalid pattern / service error returns `{ error }`, so the output is a three-way union.
const knowledgeReadResultSchema = z.union([kbReadOutputSchema, kbGrepOutputSchema, knowledgeLookupErrorSchema])

const kbReadTool = tool({
  description: KNOWLEDGE_READ_DESCRIPTION,
  inputSchema: kbReadInputSchema,
  outputSchema: knowledgeReadResultSchema,
  strict: true,
  execute: async (input, options) => {
    const { request } = getToolCallContext(options)
    return readOrGrepConcept(input, request.knowledgeBaseIds ?? [])
  },
  toModelOutput: ({ output }) => knowledgeReadModelOutput(output)
})

export function createKbReadToolEntry(): ToolEntry {
  return {
    name: KB_READ_TOOL_NAME,
    namespace: 'kb',
    description: 'Read a knowledge base document by its Concept ID, or grep within it',
    defer: 'always',
    tool: kbReadTool,
    applies: (scope) => scope.hasAnyKnowledgeBase === true && (scope.knowledgeBaseIds?.length ?? 0) > 0
  }
}

export type KnowledgeReadToolInput = InferToolInput<typeof kbReadTool>
export type KnowledgeReadToolOutput = InferToolOutput<typeof kbReadTool>
