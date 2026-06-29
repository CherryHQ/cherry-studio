/**
 * Knowledge base document read tool — deep-read companion to `kb_search`.
 *
 * The model passes a `conceptId` + `baseId` from a `kb_search` hit to read the
 * full source document (or a slice of it). Per-request
 * `assistant.knowledgeBaseIds` flows in via RequestContext and scopes which
 * bases are reachable. The read itself lives in the shared `knowledgeLookup`
 * core so the Claude Code MCP bridge runs identical logic; this file is just the
 * AI-SDK `tool()` wrapper.
 */

import { KB_READ_TOOL_NAME, kbReadInputSchema, kbReadOutputSchema } from '@shared/ai/builtinTools'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import {
  KNOWLEDGE_READ_DESCRIPTION,
  knowledgeLookupErrorSchema,
  knowledgeReadModelOutput,
  readConcept
} from '../../../knowledgeLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export { KB_READ_TOOL_NAME }

// Mirror kb_search: an out-of-scope base / unknown concept / service error returns `{ error }`, so the output is a union.
const knowledgeReadResultSchema = z.union([kbReadOutputSchema, knowledgeLookupErrorSchema])

const kbReadTool = tool({
  description: KNOWLEDGE_READ_DESCRIPTION,
  inputSchema: kbReadInputSchema,
  outputSchema: knowledgeReadResultSchema,
  strict: true,
  execute: async ({ baseId, conceptId, charStart, charEnd }, options) => {
    const { request } = getToolCallContext(options)
    return readConcept(baseId, conceptId, { charStart, charEnd }, request.assistant?.knowledgeBaseIds ?? [])
  },
  toModelOutput: ({ output }) => knowledgeReadModelOutput(output)
})

export function createKbReadToolEntry(): ToolEntry {
  return {
    name: KB_READ_TOOL_NAME,
    namespace: 'kb',
    description: 'Read the full text of a knowledge base document by its Concept ID',
    defer: 'always',
    tool: kbReadTool,
    applies: (scope) => (scope.assistant?.knowledgeBaseIds?.length ?? 0) > 0
  }
}

export type KnowledgeReadToolInput = InferToolInput<typeof kbReadTool>
export type KnowledgeReadToolOutput = InferToolOutput<typeof kbReadTool>
