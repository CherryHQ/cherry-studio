/**
 * Render-time citation registry — resolves a message's inline citations
 * directly from its own parts, with no persisted reference metadata:
 *
 * - `tool-web_search` / `tool-web_fetch` / `tool-kb_search` results (assistant
 *   runtime), including the same tools called through `tool_invoke` (deferred)
 *   or the `cherry-tools` in-process MCP server (agent runtime, `dynamic-tool`
 *   parts). Result ids ("k3f-2") are minted per lookup call in the main
 *   process (`citationIds.ts`) and echoed back by the model as `[cite:id]`.
 * - `source-url` parts from provider-native web search, keyed by their
 *   provider-assigned numbers so plain `[N]` markers resolve.
 *
 * Migrated v1 messages carry `providerMetadata.cherry.references` instead and
 * keep rendering through the legacy `partsToBlocks` path — MainTextBlock
 * prefers that path whenever reference metadata is present.
 */

import type { Citation } from '@renderer/types/message'
import { WEB_SEARCH_SOURCE } from '@renderer/types/webSearchProvider'
import { mapCitationMarksToTags, normalizeCitationMarks } from '@renderer/utils/citation'
import { cleanMarkdownContent } from '@renderer/utils/formats'
import {
  KB_SEARCH_TOOL_NAME,
  kbSearchOutputSchema,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  webSearchOutputSchema
} from '@shared/ai/builtinTools'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { DynamicToolUIPart, ToolUIPart, UIDataTypes, UIMessagePart, UITools } from 'ai'
import { getToolName, isToolUIPart } from 'ai'

import { normalizeToolOutputResponse } from '../tools/toolResponse'

export interface MessageCitations {
  /** Wire id (stringified) → citation with its assigned display number. */
  byId: Map<string, Citation>
  /**
   * Bare `[N]` marker resolution: provider-native `source-url` numbers always;
   * lookup-tool ids by their numeric value/suffix only when the message holds a
   * single lookup call (old numeric-id messages and weak-model fallback) —
   * with more calls a bare number is ambiguous and stays literal.
   */
  byMarkerNumber: Map<number, Citation>
  /** All citations in part order, display numbers 1..K. */
  all: Citation[]
}

const EMPTY_MESSAGE_CITATIONS: MessageCitations = { byId: new Map(), byMarkerNumber: new Map(), all: [] }

const CITABLE_TOOL_NAMES: ReadonlySet<string> = new Set([
  WEB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  KB_SEARCH_TOOL_NAME
])
const CHERRY_TOOLS_MCP_SERVER = 'cherry-tools'
const TOOL_INVOKE_TOOL_NAME = 'tool_invoke'

type ToolResponsePart = ToolUIPart<UITools> | DynamicToolUIPart

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toHostOrUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** Provider `sourceId` of the form `citation-<n>` (0-based) → marker number. */
function sourceIdToNumber(sourceId: unknown): number | undefined {
  if (typeof sourceId !== 'string') return undefined
  const match = sourceId.match(/^citation-(\d+)$/)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) && value >= 0 ? value + 1 : undefined
}

/**
 * The builtin lookup tool a part's completed output belongs to, across all
 * three wire shapes (static AI-SDK part, tool_invoke wrapper, cherry-tools
 * MCP dynamic-tool). Third-party MCP tools that happen to share a name are
 * deliberately excluded.
 */
function resolveCitableToolName(part: CherryMessagePart): string | null {
  if (!isToolUIPart(part as UIMessagePart<UIDataTypes, UITools>)) return null
  const toolPart = part as unknown as ToolResponsePart
  if (toolPart.state !== 'output-available') return null

  const rawName = getToolName(toolPart)
  if (CITABLE_TOOL_NAMES.has(rawName)) return rawName

  if (rawName === TOOL_INVOKE_TOOL_NAME) {
    const input = toolPart.input
    if (isRecord(input) && typeof input.name === 'string' && CITABLE_TOOL_NAMES.has(input.name)) return input.name
    return null
  }

  const parsed = parseFunctionCallToolName(rawName)
  if (parsed && parsed.serverPart === CHERRY_TOOLS_MCP_SERVER && CITABLE_TOOL_NAMES.has(parsed.toolPart)) {
    return parsed.toolPart
  }
  return null
}

/** Numeric value a lookup-result id can answer a bare `[N]` marker with. */
function markerNumberOfId(id: string | number): number | undefined {
  if (typeof id === 'number') return id
  const suffix = id.match(/(\d+)$/)?.[1]
  return suffix ? Number(suffix) : undefined
}

export function resolveMessageCitations(parts: readonly CherryMessagePart[]): MessageCitations {
  const byId = new Map<string, Citation>()
  const byMarkerNumber = new Map<number, Citation>()
  const all: Citation[] = []
  const byUrl = new Map<string, Citation>()

  // Provider-native results keep their provider-assigned numbers so the plain
  // `[N]` markers in the model text resolve (ported from the retired
  // persist-time normalizer).
  for (const part of parts) {
    if (part.type !== 'source-url' || typeof part.url !== 'string' || !part.url || byUrl.has(part.url)) continue
    const number = sourceIdToNumber(part.sourceId) ?? all.length + 1
    const citation: Citation = {
      number,
      url: part.url,
      title: part.title || toHostOrUrl(part.url),
      showFavicon: true,
      type: 'websearch'
    }
    byId.set(String(number), citation)
    byMarkerNumber.set(number, citation)
    byUrl.set(part.url, citation)
    all.push(citation)
  }

  let nextNumber = all.reduce((max, citation) => Math.max(max, citation.number), 0) + 1
  let lookupCallCount = 0
  const toolMarkerCandidates = new Map<number, Citation>()

  for (const part of parts) {
    const toolName = resolveCitableToolName(part)
    if (!toolName) continue
    const output = normalizeToolOutputResponse((part as { output?: unknown }).output)

    if (toolName === KB_SEARCH_TOOL_NAME) {
      const parsed = kbSearchOutputSchema.safeParse(output)
      if (!parsed.success || parsed.data.length === 0) continue
      lookupCallCount += 1
      for (const item of parsed.data) {
        const key = String(item.id)
        if (byId.has(key)) continue
        const citation: Citation = {
          number: nextNumber++,
          url: '',
          title: item.title || '',
          content: item.content,
          showFavicon: false,
          type: 'knowledge'
        }
        byId.set(key, citation)
        all.push(citation)
        const markerNumber = markerNumberOfId(item.id)
        if (markerNumber !== undefined && !toolMarkerCandidates.has(markerNumber)) {
          toolMarkerCandidates.set(markerNumber, citation)
        }
      }
      continue
    }

    const parsed = webSearchOutputSchema.safeParse(output)
    if (!parsed.success || parsed.data.length === 0) continue
    lookupCallCount += 1
    for (const item of parsed.data) {
      const key = String(item.id)
      if (byId.has(key)) continue
      const existing = item.url ? byUrl.get(item.url) : undefined
      if (existing) {
        // Same URL surfaced by another call — alias this id to the first citation.
        byId.set(key, existing)
        continue
      }
      const citation: Citation = {
        number: nextNumber++,
        url: item.url,
        title: item.title || toHostOrUrl(item.url),
        content: item.content,
        showFavicon: true,
        type: 'websearch'
      }
      byId.set(key, citation)
      if (item.url) byUrl.set(item.url, citation)
      all.push(citation)
      const markerNumber = markerNumberOfId(item.id)
      if (markerNumber !== undefined && !toolMarkerCandidates.has(markerNumber)) {
        toolMarkerCandidates.set(markerNumber, citation)
      }
    }
  }

  if (lookupCallCount === 1) {
    for (const [markerNumber, citation] of toolMarkerCandidates) {
      if (!byMarkerNumber.has(markerNumber)) byMarkerNumber.set(markerNumber, citation)
    }
  }

  if (all.length === 0) return EMPTY_MESSAGE_CITATIONS
  return { byId, byMarkerNumber, all }
}

/**
 * Transform `[cite:id]` markers (plus resolvable bare `[N]` / provider-mark
 * forms) in `content` into rendered `<sup data-citation>` tags, and report the
 * cited subset in first-appearance order for the citations footer. Unknown
 * ids stay literal.
 */
export function withToolCitationTags(
  content: string,
  citations: MessageCitations
): { content: string; cited: Citation[] } {
  if (!content || citations.byId.size === 0) return { content, cited: [] }

  const cleanCache = new Map<Citation, Citation>()
  const clean = (citation: Citation): Citation => {
    const cached = cleanCache.get(citation)
    if (cached) return cached
    const cleaned = citation.content ? { ...citation, content: cleanMarkdownContent(citation.content) } : citation
    cleanCache.set(citation, cleaned)
    return cleaned
  }

  const markerNumberMap = new Map<number, Citation>()
  for (const [markerNumber, citation] of citations.byMarkerNumber) markerNumberMap.set(markerNumber, clean(citation))

  const lookup = new Map<string, Citation>()
  for (const [id, citation] of citations.byId) lookup.set(id, clean(citation))
  // Bare markers normalize to `[cite:<number>]` — alias those keys unless a wire id already owns them.
  for (const [markerNumber, citation] of markerNumberMap) {
    const key = String(markerNumber)
    if (!lookup.has(key)) lookup.set(key, citation)
  }

  // AISDK covers both the `[<sup>N</sup>](url)` provider form and plain `[N]`.
  const normalized =
    markerNumberMap.size > 0 ? normalizeCitationMarks(content, markerNumberMap, WEB_SEARCH_SOURCE.AISDK) : content

  const cited: Citation[] = []
  const citedNumbers = new Set<number>()
  for (const match of normalized.matchAll(/\[cite:([\w-]+)\]/g)) {
    const citation = lookup.get(match[1])
    if (citation && !citedNumbers.has(citation.number)) {
      citedNumbers.add(citation.number)
      cited.push(citation)
    }
  }

  return { content: mapCitationMarksToTags(normalized, lookup), cited }
}
