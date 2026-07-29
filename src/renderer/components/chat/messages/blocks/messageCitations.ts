/**
 * Render-time citation registry — resolves a message's inline citations
 * directly from its own parts, with no persisted reference metadata:
 *
 * - `tool-web_search` / `tool-web_fetch` / `tool-kb_search` / `tool-kb_read`
 *   results (assistant runtime), including the same tools called through
 *   `tool_invoke` (deferred)
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
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  kbGrepOutputSchema,
  kbReadOutputSchema,
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
  KB_SEARCH_TOOL_NAME,
  KB_READ_TOOL_NAME
])
const CHERRY_TOOLS_MCP_SERVER = 'cherry-tools'
const TOOL_INVOKE_TOOL_NAME = 'tool_invoke'

/**
 * kb_read returns a whole document slice — orders of magnitude more text than a kb_search chunk —
 * but the tooltip only ever shows a snippet. Truncate here so the full slice is not carried
 * through the render path and re-serialized into every `<sup data-citation>` tag.
 */
const KNOWLEDGE_SNIPPET_MAX_CHARS = 300

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

function toSnippet(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length <= KNOWLEDGE_SNIPPET_MAX_CHARS) return trimmed
  return `${trimmed.slice(0, KNOWLEDGE_SNIPPET_MAX_CHARS)}…`
}

/**
 * kb_read's citable payload, across both of its modes: read mode returns one document slice, grep
 * mode returns matches from one document — either way the call yields a single source, so its
 * output carries one `id` rather than one per item. Returns null for anything not citable: an
 * error/steer string, and results persisted before kb_read joined the citation pipeline (no `id`).
 */
function parseKbReadCitation(
  output: unknown
): { id: string; conceptId: string; title: string; content: string } | null {
  const read = kbReadOutputSchema.safeParse(output)
  if (read.success) {
    const { id, conceptId, title, content } = read.data
    return id ? { id, conceptId, title, content: toSnippet(content) } : null
  }
  const grep = kbGrepOutputSchema.safeParse(output)
  if (!grep.success) return null
  const { id, conceptId, title, matches } = grep.data
  if (!id || matches.length === 0) return null
  return { id, conceptId, title, content: toSnippet(matches.map((match) => match.snippet).join(' … ')) }
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
  const byConceptId = new Map<string, Citation>()

  const addKnowledgeCitation = (item: { id: string | number; conceptId?: string; title?: string; content: string }) => {
    const key = String(item.id)
    if (byId.has(key)) return
    // One citation per document, the knowledge-base counterpart of the URL dedup below: kb_search
    // can return several chunks of one file and kb_read may then quote that same file again, but
    // the reader only cares which document backed the statement. First occurrence wins.
    const existing = item.conceptId ? byConceptId.get(item.conceptId) : undefined
    if (existing) {
      byId.set(key, existing)
      return
    }
    const citation: Citation = {
      number: nextNumber++,
      url: '',
      title: item.title || '',
      content: item.content,
      showFavicon: false,
      type: 'knowledge'
    }
    byId.set(key, citation)
    if (item.conceptId) byConceptId.set(item.conceptId, citation)
    all.push(citation)
    const markerNumber = markerNumberOfId(item.id)
    if (markerNumber !== undefined && !toolMarkerCandidates.has(markerNumber)) {
      toolMarkerCandidates.set(markerNumber, citation)
    }
  }

  for (const part of parts) {
    const toolName = resolveCitableToolName(part)
    if (!toolName) continue
    const rawOutput = (part as { output?: unknown }).output
    const output = normalizeToolOutputResponse(rawOutput)

    if (toolName === KB_SEARCH_TOOL_NAME) {
      const parsed = kbSearchOutputSchema.safeParse(output)
      if (!parsed.success || parsed.data.length === 0) continue
      lookupCallCount += 1
      for (const item of parsed.data) addKnowledgeCitation(item)
      continue
    }

    if (toolName === KB_READ_TOOL_NAME) {
      // Read mode's payload carries its own top-level `content`, which `normalizeToolOutputResponse`
      // mistakes for the MCP `{ content, metadata }` envelope and unwraps down to the bare document
      // text. Try the raw output first (assistant path); the unwrapped form only wins on the agent
      // path, where a real envelope does wrap the payload.
      const item = parseKbReadCitation(rawOutput) ?? parseKbReadCitation(output)
      if (!item) continue
      lookupCallCount += 1
      addKnowledgeCitation(item)
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
 *
 * Markers are numbered 1..N by first appearance in `content`, so the badges
 * read in order and match the footer's ordering.
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

  // Renumber by first appearance. `resolveMessageCitations` numbers every result it finds, so a
  // model citing the 41st knowledge chunk would render a bare "41" while the footer lists only the
  // handful actually cited — and the footer (ordered by appearance) would disagree with those
  // numbers whenever the model cites out of order. Display numbers are therefore assigned here,
  // where the text is known; the resolver's numbers stay as internal identity keys.
  const cited: Citation[] = []
  const displayed = new Map<Citation, Citation>()
  const renumbered = new Map<string, Citation>()
  for (const match of normalized.matchAll(/\[cite:([\w-]+)\]/g)) {
    const citation = lookup.get(match[1])
    if (!citation) continue
    let display = displayed.get(citation)
    if (!display) {
      display = { ...citation, number: cited.length + 1 }
      displayed.set(citation, display)
      cited.push(display)
    }
    renumbered.set(match[1], display)
  }

  return { content: mapCitationMarksToTags(normalized, renumbered), cited }
}
