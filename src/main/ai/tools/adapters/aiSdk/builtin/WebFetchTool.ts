/**
 * Web fetch tool — agentic.
 *
 * The model supplies known page URLs (often from a prior `web_search`) and
 * gets back their readable content. The lookup itself lives in the shared
 * `webLookup` core so the Claude Code MCP bridge runs identical logic; this
 * file is just the AI-SDK `tool()` wrapper.
 */

import { markTrustedLocalToolTerminalFailure } from '@main/ai/runtime/aiSdk'
import { WEB_FETCH_TOOL_NAME, webFetchInputSchema, webFetchOutputSchema } from '@shared/ai/builtinTools'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import { makeEntitiesCodec } from '../../../outputCodec'
import { fetchWeb, WEB_FETCH_DESCRIPTION, webLookupErrorSchema, webLookupModelOutput } from '../../../webLookup'
import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

const webFetchResultSchema = z.union([webFetchOutputSchema, webLookupErrorSchema])

const webFetchTool = tool({
  description: WEB_FETCH_DESCRIPTION,
  inputSchema: webFetchInputSchema,
  outputSchema: webFetchResultSchema,
  strict: true,
  execute: async ({ urls }, options) =>
    markTrustedLocalToolTerminalFailure(await fetchWeb(urls, getToolCallContext(options).request.abortSignal)),
  toModelOutput: ({ output }) => webLookupModelOutput(output)
})

export function createWebFetchToolEntry(): ToolEntry {
  return {
    name: WEB_FETCH_TOOL_NAME,
    // Entity codec instead of the blanket truncatable:false it used to carry:
    // a fetched page's citation identity is its URL (in the input AND the
    // result skeleton), so trimming per-entity `content` loses nothing the
    // model cites — while an uncapped page was the one output no context
    // guard covered (compaction never folds the current turn; finding #7).
    codec: makeEntitiesCodec({ contentKey: 'content' }),
    namespace: 'web',
    description: 'Fetch readable content from known web page URLs',
    defer: 'auto',
    tool: webFetchTool,
    applies: (scope) => scope.webToolRoutes?.webFetch === 'client'
  }
}

export type WebFetchToolInput = InferToolInput<typeof webFetchTool>
export type WebFetchToolOutput = InferToolOutput<typeof webFetchTool>
