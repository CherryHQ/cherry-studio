/**
 * Web search tool — agentic.
 *
 * The model picks search queries and may call multiple times with refined
 * terms. The actual lookup (provider resolution, mapping, error handling)
 * lives in the shared `webLookup` core so the Claude Code MCP bridge runs the
 * exact same logic; this file is just the AI-SDK `tool()` wrapper.
 */

import {
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  webSearchInputSchema,
  webSearchOutputSchema
} from '@shared/ai/builtinTools'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import { searchWeb, WEB_SEARCH_DESCRIPTION, webLookupErrorSchema, webLookupModelOutput } from '../../../webLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

export { WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME }

const webSearchResultSchema = z.union([webSearchOutputSchema, webLookupErrorSchema])

const webSearchTool = tool({
  description: WEB_SEARCH_DESCRIPTION,
  inputSchema: webSearchInputSchema,
  outputSchema: webSearchResultSchema,
  // Provider-level constrained decoding where supported. Repair fallback
  // (in AiService) handles providers that don't honour `strict`.
  strict: true,
  execute: async ({ query }, options) => searchWeb(query, getToolCallContext(options).request.abortSignal),
  toModelOutput: ({ output }) => webLookupModelOutput(output)
})

export function createWebSearchToolEntry(): ToolEntry {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    namespace: 'web',
    description: 'Search the web for current information',
    defer: 'auto',
    tool: webSearchTool,
    applies: (scope) => Boolean(scope.assistant?.settings?.enableWebSearch)
  }
}

export type WebSearchToolInput = InferToolInput<typeof webSearchTool>
export type WebSearchToolOutput = InferToolOutput<typeof webSearchTool>
