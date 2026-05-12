/**
 * Web search tool — agentic.
 *
 * The model picks the query and may call multiple times with refined terms.
 * Provider id is resolved at execute time by picking the first configured-and-
 * usable web search provider (matching Cherry's renderer UX where any
 * configured provider works). If the user has none configured, the tool
 * returns an empty array — the model sees that and can fall back to its
 * own knowledge.
 *
 * Replaces the deleted workflow-style `webSearchToolWithPreExtractedKeywords`
 * factory whose intent analyzer pre-baked queries into the tool itself.
 */

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { makeNeedsApproval } from '@main/services/toolApproval/needsApproval'
import { getResolvedConfig } from '@main/services/webSearch/utils/config'
import { webSearchService } from '@main/services/webSearch/WebSearchService'
import {
  WEB_SEARCH_TOOL_NAME,
  webSearchInputSchema,
  type WebSearchOutput,
  webSearchOutputSchema
} from '@shared/ai/builtinTools'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'

import { getToolCallContext } from '../context'
import { BuiltinToolNamespace, ToolCapability, ToolDefer, type ToolEntry } from '../types'

const logger = loggerService.withContext('WebSearchTool')

export { WEB_SEARCH_TOOL_NAME }

const webSearchTool = tool({
  description: `Search the web for current information, news, and real-time data.

Use this when:
- The user asks about recent events, current prices, or live data
- You need to verify facts you're uncertain about or that may have changed
- The user references something you don't have context on

Don't use for:
- Math, code reasoning, or things you can answer from your training
- Well-known facts unlikely to have changed

You may call this multiple times with different queries to broaden coverage:
- If the topic likely has more authoritative sources in another language
  (English for tech / scientific topics, the local language for regional news,
  Japanese for anime / manga, etc.), repeat the search with the topic translated
  into the most likely source language.
- If the first results miss an angle, refine with synonyms or sub-aspects.

Cite sources by [id] in your final answer.`,
  inputSchema: webSearchInputSchema,
  outputSchema: webSearchOutputSchema,
  inputExamples: [{ input: { query: 'Anthropic Claude 4 Opus benchmarks 2026' } }],
  // Provider-level constrained decoding where supported. Repair fallback
  // (in AiService) handles providers that don't honour `strict`.
  strict: true,
  needsApproval: makeNeedsApproval(WEB_SEARCH_TOOL_NAME),
  execute: async ({ query }, options): Promise<WebSearchOutput> => {
    const { request } = getToolCallContext(options)

    const provider = await pickFirstUsableProvider()
    if (!provider) {
      logger.warn('No usable web search provider configured', { query })
      return []
    }

    try {
      const response = await webSearchService.search({
        providerId: provider.id,
        questions: [query],
        requestId: request.requestId
      })
      return response.results.map((r, index) => ({
        id: index + 1,
        title: r.title,
        url: r.url,
        content: r.content
      }))
    } catch (error) {
      logger.error('webSearchService.search failed', error as Error, {
        providerId: provider.id,
        query
      })
      return []
    }
  }
})

/**
 * Pick the first provider that's usable: either an API-key-free "local-*"
 * provider, or one with at least one non-empty API key, or one with a
 * configured apiHost (e.g. self-hosted SearXNG). Mirrors the renderer's
 * `webSearchService.isWebSearchEnabled` selection logic.
 */
async function pickFirstUsableProvider(): Promise<ResolvedWebSearchProvider | undefined> {
  const prefs = application.get('PreferenceService')
  const config = await getResolvedConfig(prefs)
  return config.providers.find((p) => p.id.startsWith('local-') || p.apiKeys.length > 0 || p.apiHost.length > 0)
}

export function createWebSearchToolEntry(): ToolEntry {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    namespace: BuiltinToolNamespace.Web,
    description: 'Search the web for current information',
    defer: ToolDefer.Auto,
    capability: ToolCapability.Read,
    tool: webSearchTool,
    applies: () => true,
    checkPermissions: () => ({ behavior: 'allow' }),
    // Citation contract: results carry `[id]` anchors the model references
    // back. Mid-array truncation breaks those refs → opt out of context-build
    // truncation entirely.
    truncatable: false
  }
}

export type WebSearchToolInput = InferToolInput<typeof webSearchTool>
export type WebSearchToolOutput = InferToolOutput<typeof webSearchTool>
