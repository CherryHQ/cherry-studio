/**
 * Web fetch tool — agentic.
 *
 * The model supplies known page URLs (often from a prior `web_search`) and
 * gets back their readable content. The lookup itself lives in the shared
 * `webLookup` core so the Claude Code MCP bridge runs identical logic; this
 * file is just the AI-SDK `tool()` wrapper.
 */

import { WEB_FETCH_TOOL_NAME, webFetchInputSchema, webFetchOutputSchema } from '@shared/ai/builtinTools'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import { fetchWeb, WEB_FETCH_DESCRIPTION, webLookupErrorSchema, webLookupModelOutput } from '../../../webLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

const webFetchResultSchema = z.union([webFetchOutputSchema, webLookupErrorSchema])

const webFetchTool = tool({
  description: WEB_FETCH_DESCRIPTION,
  inputSchema: webFetchInputSchema,
  outputSchema: webFetchResultSchema,
  strict: true,
  execute: async ({ urls }, options) => fetchWeb(urls, getToolCallContext(options).request.abortSignal),
  toModelOutput: ({ output }) => webLookupModelOutput(output)
})

export function createWebFetchToolEntry(): ToolEntry {
  return {
    name: WEB_FETCH_TOOL_NAME,
    namespace: 'web',
    description: 'Fetch readable content from known web page URLs',
    defer: 'auto',
    tool: webFetchTool,
    applies: (scope) => Boolean(scope.assistant?.settings?.enableWebSearch)
  }
}

export type WebFetchToolInput = InferToolInput<typeof webFetchTool>
export type WebFetchToolOutput = InferToolOutput<typeof webFetchTool>
