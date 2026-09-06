/**
 * Citation text-tag pipeline — converts source-specific citation marks in
 * markdown content into a uniform `[<sup data-citation='N'>N</sup>](url)`
 * tagged shape that the chat layer's `<a>` renderer can detect.
 *
 * This module lives in the renderer because it encodes business knowledge:
 * the LLM provider enumeration, each provider's wire format for citation
 * markers, and how to project our chat `Citation` shape into rendered markers.
 * Tooltip data stays out-of-band in the message's trusted registry. The markdown package
 * upstream is intentionally provider-agnostic.
 */

import type { GroundingSupport } from '@google/genai'
import type { Citation } from '@renderer/types/message'
import { WEB_SEARCH_SOURCE, type WebSearchSource } from '@renderer/types/webSearchProvider'
import { cleanMarkdownContent } from '@renderer/utils/formats'

const MARKDOWN_CODE_PATTERN = /```[\s\S]*?```|`[^`\n]*`/gm

/** Apply a transform only to prose, preserving inline and fenced code byte-for-byte. */
export function mapMarkdownOutsideCode(content: string, transform: (text: string) => string): string {
  MARKDOWN_CODE_PATTERN.lastIndex = 0
  let cursor = 0
  let result = ''
  let match: RegExpExecArray | null

  while ((match = MARKDOWN_CODE_PATTERN.exec(content)) !== null) {
    result += transform(content.slice(cursor, match.index))
    result += match[0]
    cursor = match.index + match[0].length
  }

  return result + transform(content.slice(cursor))
}

/** Tooltip projection shared by the tag emitter and the trusted renderer registry. */
export function toTooltipCitation(citation: Citation): Citation {
  return citation.content
    ? { ...citation, content: cleanMarkdownContent(citation.content).substring(0, 200) }
    : citation
}

/** Pick the first valid source identifier out of a citation-reference list. */
export function determineCitationSource(
  citationReferences: Array<{ citationBlockId?: string; citationBlockSource?: WebSearchSource }> | undefined
): WebSearchSource | undefined {
  if (citationReferences?.length) {
    const validReference = citationReferences.find((ref) => ref.citationBlockSource)
    return validReference?.citationBlockSource
  }
  return undefined
}

/**
 * Convert any source-specific citation marks in `content` into rendered
 * `[<sup data-citation='N'>N</sup>](url)` tags. Pipeline:
 *   1. Normalize source-specific marks (e.g. `[<sup>N</sup>](url)` → `[cite:N]`)
 *   2. Map `[cite:N]` → rendered tag via `generateCitationTag`
 *
 * Pre-cleans each citation's `content` field with `cleanMarkdownContent` so
 * the tooltip preview shows tidy plain text instead of raw markdown.
 */
export function withCitationTags(content: string, citations: Citation[], sourceType?: WebSearchSource): string {
  if (!content || citations.length === 0) return content
  const cleaned = citations.map(toTooltipCitation)
  const citationMap = new Map(cleaned.map((c) => [c.number, c]))
  const normalizedContent = normalizeCitationMarks(content, citationMap, sourceType)
  return mapCitationMarksToTags(normalizedContent, new Map(cleaned.map((c) => [String(c.number), c])))
}

/**
 * Normalize source-specific citation marks into the canonical `[cite:N]` form.
 * Code blocks are protected (a `[N]` in a code block is content, not a citation).
 */
export function normalizeCitationMarks(
  content: string,
  citationMap: Map<number, Citation>,
  sourceType?: WebSearchSource
): string {
  const codeBlockRegex = MARKDOWN_CODE_PATTERN
  const getSkipRanges = () => {
    const skipRanges: Array<{ start: number; end: number }> = []

    codeBlockRegex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = codeBlockRegex.exec(content)) !== null) {
      skipRanges.push({
        start: match.index,
        end: match.index + match[0].length
      })
    }

    return skipRanges
  }

  // 检查位置是否在代码块内
  const shouldSkip = (pos: number, skipRanges = getSkipRanges()): boolean => {
    for (const range of skipRanges) {
      if (pos >= range.start && pos < range.end) return true
      if (range.start > pos) break
    }
    return false
  }

  const applyReplacements = (regex: RegExp, getReplacementFn: (m: RegExpExecArray) => string | null) => {
    const replacements: Array<{ start: number; end: number; replacement: string }> = []
    const skipRanges = getSkipRanges()

    regex.lastIndex = 0 // 重置正则状态
    let m: RegExpExecArray | null
    while ((m = regex.exec(content)) !== null) {
      if (!shouldSkip(m.index, skipRanges)) {
        const replacement = getReplacementFn(m)
        if (replacement !== null) {
          replacements.push({ start: m.index, end: m.index + m[0].length, replacement })
        }
      }
    }
    replacements.reverse().forEach(({ start, end, replacement }) => {
      content = content.slice(0, start) + replacement + content.slice(end)
    })
  }

  const normalizePlainBracketMarks = () => {
    applyReplacements(/\[(\d+)\]/g, (match) => {
      const citationNum = parseInt(match[1], 10)
      return citationMap.has(citationNum) ? `[cite:${citationNum}]` : null
    })
  }

  switch (sourceType) {
    case WEB_SEARCH_SOURCE.OPENAI:
    case WEB_SEARCH_SOURCE.OPENAI_RESPONSE:
    case WEB_SEARCH_SOURCE.AISDK:
    case WEB_SEARCH_SOURCE.PERPLEXITY: {
      applyReplacements(/\[<sup>(\d+)<\/sup>\]\([^)]*\)/g, (m) => {
        const citationNum = parseInt(m[1], 10)
        return citationMap.has(citationNum) ? `[cite:${citationNum}]` : null
      })
      normalizePlainBracketMarks()
      break
    }
    case WEB_SEARCH_SOURCE.GEMINI: {
      const firstCitation = Array.from(citationMap.values())[0]
      const metadata = firstCitation?.metadata as GroundingSupport[] | undefined
      if (metadata?.length) {
        const encoder = new TextEncoder()
        const contentBytes = encoder.encode(content)

        const byteOffsetToCharOffset = (byteOffset: number): number => {
          const decoder = new TextDecoder()
          return decoder.decode(contentBytes.slice(0, byteOffset)).length
        }

        const insertions: Array<{ position: number; tag: string }> = []
        metadata.forEach((support) => {
          if (!support.groundingChunkIndices || !support.segment) return
          const { endIndex } = support.segment
          if (endIndex == null) return

          const tag = support.groundingChunkIndices
            .map((citationNum) => {
              const citation = citationMap.get(citationNum + 1)
              return citation ? `[cite:${citationNum + 1}]` : ''
            })
            .filter(Boolean)
            .join('')

          if (tag) {
            insertions.push({ position: byteOffsetToCharOffset(endIndex), tag })
          }
        })

        insertions.sort((a, b) => b.position - a.position)
        for (const { position, tag } of insertions) {
          if (!shouldSkip(position)) {
            content = content.slice(0, position) + tag + content.slice(position)
          }
        }
      }
      break
    }
    case WEB_SEARCH_SOURCE.GROK: {
      applyReplacements(/\[\[(\d+)\]\]\([^)]*\)/g, (m) => {
        const citationNum = parseInt(m[1], 10)
        return citationMap.has(citationNum) ? `[cite:${citationNum}]` : null
      })
      break
    }
    default: {
      // 简单数字格式: [N] → [cite:N]
      normalizePlainBracketMarks()
    }
  }

  return content
}

/**
 * A `[cite:id]` marker together with the space that separates it from the
 * preceding sentence, so a dropped marker takes that space with it instead of
 * leaving `Claim .` behind. Shared with the export/strip paths in
 * `utils/message/citations.ts`.
 */
export const CITATION_MARKER_PATTERN = /([ \t]?)\[cite:([\w-]+)\]/g

/**
 * Map every `[cite:<id>]` mark to a rendered `[<sup>…</sup>](url)` tag. Keys
 * are wire ids as strings: legacy numeric marks stringify to their number,
 * tool-result ids keep their `<prefix>-<n>` form.
 *
 * An id that resolves to nothing is dropped rather than echoed: the id is an
 * internal, conversation-scoped handle, so printing it puts implementation
 * detail on screen (#19771). An id from a turn that is not loaded, or one the
 * model invented, is how a marker gets here.
 */
export function mapCitationMarksToTags(content: string, citationMap: Map<string, Citation>): string {
  return mapMarkdownOutsideCode(content, (text) =>
    text.replace(CITATION_MARKER_PATTERN, (_match, space: string, id: string) => {
      const citation = citationMap.get(id)
      return citation ? `${space}${generateCitationTag(citation)}` : ''
    })
  )
}

/**
 * Whether a citation URL can be rendered as a markdown link. Migrated v1
 * knowledge citations carry truthy non-URL values (raw file paths, the literal
 * `note`), so a plain truthiness test disagrees with what `generateCitationTag`
 * emits. Single source of truth: `CitationSup` mounts the tooltip on exactly
 * the citations this rejects.
 */
export const isLinkableCitationUrl = (url?: string): boolean => !!url && url.startsWith('http')

/** Build the rendered tag for a single citation. */
export function generateCitationTag(citation: Citation): string {
  const supTag = `<sup data-citation='${citation.number}'>${citation.number}</sup>`
  if (!isLinkableCitationUrl(citation.url)) {
    // Knowledge-base and memory citations have no URL. Wrapping them in `[...]()` yields an empty
    // href, which rehype-harden unwraps into `<span>…<sup/></span>` — dropping the tooltip, since
    // it only mounts on `<a>`. Emit the bare `<sup>` instead; `components.sup` (CitationSup)
    // mounts the tooltip for this case.
    return supTag
  }

  const safeUrl = citation.url.replace(/\|/g, '%7C')
  return `[${supTag}](${safeUrl})`
}
