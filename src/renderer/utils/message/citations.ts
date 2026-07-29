/**
 * Citation registry — resolves a message's inline citations directly from its
 * own parts, with no persisted reference metadata:
 *
 * - `tool-web_search` / `tool-web_fetch` / `tool-kb_search` / `tool-kb_read`
 *   results (assistant runtime), including the same tools called through
 *   `tool_invoke` (deferred)
 *   or the `cherry-tools` in-process MCP server (agent runtime, `dynamic-tool`
 *   parts). Result ids ("3f2a1b9c-2") are minted per lookup call in the main
 *   process (`citationIds.ts`) and echoed back by the model as `[cite:id]`.
 * - `source-url` parts from provider-native web search, keyed by their
 *   provider-assigned numbers so plain `[N]` markers resolve.
 *
 * This lives in `utils/` rather than beside the chat blocks because the markers
 * sit in the *persisted* message text: rendering, Markdown/plain-text export and
 * copy-to-clipboard all have to resolve them, and only rendering goes through
 * `components/`. `resolveCitationMarkers` is the shared core — `withToolCitationTags`
 * is the render-side wrapper that turns the markers into `<sup>` badges.
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

import { normalizeToolOutputResponse } from './toolOutput'

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
): { id: string; baseId?: string; conceptId: string; title: string; content: string } | null {
  const read = kbReadOutputSchema.safeParse(output)
  if (read.success) {
    const { id, baseId, conceptId, title, content } = read.data
    return id ? { id, baseId, conceptId, title, content: toSnippet(content) } : null
  }
  const grep = kbGrepOutputSchema.safeParse(output)
  if (!grep.success) return null
  const { id, baseId, conceptId, title, matches } = grep.data
  if (!id || matches.length === 0) return null
  return { id, baseId, conceptId, title, content: toSnippet(matches.map((match) => match.snippet).join(' … ')) }
}

/**
 * Document identity for the one-citation-per-document dedup. `conceptId` is a
 * base-relative path, so it only identifies a document within its own base —
 * two bases can each hold a `README.md`. Results persisted before `baseId` was
 * propagated carry none; those keep deduping on the bare `conceptId`, which is
 * how they already behaved.
 */
function documentKey(item: { baseId?: string; conceptId?: string }): string | undefined {
  if (!item.conceptId) return undefined
  // NUL separator: neither id can contain one, so the join is unambiguous.
  return `${item.baseId ?? ''}\u0000${item.conceptId}`
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
  const byDocument = new Map<string, Citation>()

  const addKnowledgeCitation = (item: {
    id: string | number
    baseId?: string
    conceptId?: string
    title?: string
    content: string
  }) => {
    const key = String(item.id)
    if (byId.has(key)) return
    // One citation per document, the knowledge-base counterpart of the URL dedup below: kb_search
    // can return several chunks of one file and kb_read may then quote that same file again, but
    // the reader only cares which document backed the statement. First occurrence wins.
    const document = documentKey(item)
    const existing = document ? byDocument.get(document) : undefined
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
    if (document) byDocument.set(document, citation)
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

/** Resolved markers, ready for a caller to render, rewrite or strip. */
export interface ResolvedCitationMarkers {
  /**
   * `content` with provider-specific marks normalized to `[cite:id]` and repeat
   * badges collapsed. Markers are left in place — the caller decides what they
   * become (a `<sup>` badge when rendering, `[N]` or nothing when exporting).
   */
  content: string
  /** Marker id → the citation it resolves to, renumbered by first appearance. */
  byMarker: Map<string, Citation>
  /** The cited subset in first-appearance order, for the citations footer / sources list. */
  cited: Citation[]
}

/**
 * Resolve `[cite:id]` markers (plus resolvable bare `[N]` / provider-mark forms)
 * in `content` against a message's citations. Unknown ids stay literal.
 *
 * Markers are numbered 1..N by first appearance in `content`, so the badges read
 * in order and match the footer's ordering.
 *
 * Shared by every consumer of the markers — rendering, Markdown/plain-text
 * export and copy — so all three agree on which marker means which source.
 */
export function resolveCitationMarkers(content: string, citations: MessageCitations): ResolvedCitationMarkers {
  if (!content || citations.byId.size === 0) return { content, byMarker: new Map(), cited: [] }

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

  // The model chains one marker per supporting result, but several results can resolve to one
  // source — two chunks of the same document, or a kb_search hit it then re-read. Those would
  // render as the same badge twice in a row, so keep only the first of each within a run of
  // adjacent markers. Unresolved ids stay put, and a lone marker is never touched.
  const collapsed = normalized.replace(/\[cite:[\w-]+\](?:[ \t]*\[cite:[\w-]+\])+/g, (run) => {
    const seen = new Set<Citation>()
    const kept: string[] = []
    for (const match of run.matchAll(/\[cite:([\w-]+)\]/g)) {
      const citation = renumbered.get(match[1])
      if (citation && seen.has(citation)) continue
      if (citation) seen.add(citation)
      kept.push(match[0])
    }
    return kept.join('')
  })

  return { content: collapsed, byMarker: renumbered, cited }
}

/**
 * A `[cite:id]` marker together with the space that separates it from the
 * preceding sentence, so a dropped marker takes that space with it instead of
 * leaving `Claim .` behind.
 */
const CITATION_MARKER_PATTERN = /([ \t]?)\[cite:([\w-]+)\]/g

/**
 * Export / copy view: every resolved `[cite:id]` marker becomes a plain `[N]`,
 * and an id that resolves to nothing is dropped — an internal marker must never
 * escape into exported text or the clipboard. Also returns the cited sources in
 * display order so the caller can render a sources list.
 *
 * Rendering deliberately leaves an unresolved id visible (it is a model mistake
 * worth seeing on screen); an export is a finished document, so it is removed.
 */
export function toExportableCitations(
  content: string,
  parts: readonly CherryMessagePart[]
): { content: string; cited: Citation[] } {
  const { content: resolved, byMarker, cited } = resolveCitationMarkers(content, resolveMessageCitations(parts))
  return {
    content: resolved.replace(CITATION_MARKER_PATTERN, (_match, space: string, id: string) => {
      const citation = byMarker.get(id)
      return citation ? `${space}[${citation.number}]` : ''
    }),
    cited
  }
}

/**
 * Drop every `[cite:id]` marker without resolving it.
 *
 * For text that sits outside the numbered answer — reasoning traces above all.
 * Those markers point at the same tool results, but the numbering belongs to the
 * answer body; resolving them here would either restart at `[1]` or emit numbers
 * that contradict it. Stripping keeps the internal marker out of the export
 * without inventing a second, conflicting sequence.
 */
export function stripCitationMarkers(content: string): string {
  return content.replace(CITATION_MARKER_PATTERN, '')
}

/**
 * Render-side wrapper: resolve the markers, then turn each into its
 * `<sup data-citation>` badge. Unknown ids stay literal.
 */
export function withToolCitationTags(
  content: string,
  citations: MessageCitations
): { content: string; cited: Citation[] } {
  const { content: resolved, byMarker, cited } = resolveCitationMarkers(content, citations)
  return { content: mapCitationMarksToTags(resolved, byMarker), cited }
}
