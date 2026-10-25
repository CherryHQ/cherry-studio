import { estimateTokenCount } from 'tokenx'

import type { KnowledgeChunkStrategy } from '@shared/data/types/knowledge'

/**
 * A chunk of source text together with its code-unit offsets into that source.
 * The defining invariant is `source.slice(start, end) === text` — the chunk is a
 * verbatim slice, never a transformed copy. This is what lets the per-base index
 * store keep one canonical `content.text` row and derive every unit's body by
 * slicing it (knowledge-technical-design.md §5.3), instead of storing the body
 * text twice.
 */
export interface TextChunk {
  text: string
  /** Inclusive start offset (UTF-16 code units) into the source string. */
  start: number
  /** Exclusive end offset (UTF-16 code units) into the source string. */
  end: number
}

export interface SplitOptions {
  /** Target maximum tokens per chunk. */
  chunkSize: number
  /** Tokens of trailing context repeated at the start of the next chunk. */
  chunkOverlap: number
  /**
   * Primary break delimiter in escaped form (e.g. `"\\n\\n"`, `"。"`). Unescaped
   * before use. When set, cuts are preferred at its boundaries. Defaults to none.
   */
  separator?: string
  /**
   * Chunking strategy. `'structured'` (default) snaps cuts to markdown
   * heading / code-fence / rule / paragraph breaks, never splits a code fence,
   * and treats `separator` as a paragraph-level break. `'delimiter'` splits the
   * text purely by `separator` then a fallback delimiter chain, ignoring
   * markdown structure.
   */
  strategy?: KnowledgeChunkStrategy
}

/** A candidate place to cut, scored by how clean a boundary it is. */
interface BreakPoint {
  pos: number
  score: number
  /** A sentence or block end that may be used outside the normal look-back window. */
  sentence?: boolean
}

interface BreakPattern {
  pattern: RegExp
  score: number
  /** Cut at the end of the match (sentence punctuation) instead of its start. */
  cutAfter?: boolean
  /** A clean sentence/block end, eligible for the fallback search. */
  sentence?: boolean
}

/** A `\`\`\``, `$$` or `<table>` region where preferred break points should be ignored. */
type AtomicRegionKind = 'code' | 'table' | 'math' | 'inline-math' | 'inline-code'

interface AtomicRegion {
  start: number
  end: number
  kind: AtomicRegionKind
}

/**
 * Markdown break patterns scored by boundary quality (higher = better place to
 * split). Headings dominate, then code-block edges and rules, then paragraph,
 * list and bare-newline fallbacks. Adapted from the structure-aware
 * chunker design used by qmd / MinerU Document Explorer — structural breaks
 * yield far more coherent retrieval units than fixed-size windows, while still
 * cutting at exact source offsets. Each pattern's match index is the cut point.
 */
const BREAK_PATTERNS: BreakPattern[] = [
  { pattern: /\n#{1}(?!#)/g, score: 100 }, // h1
  { pattern: /\n#{2}(?!#)/g, score: 90 }, // h2
  { pattern: /\n#{3}(?!#)/g, score: 80 }, // h3
  { pattern: /\n#{4}(?!#)/g, score: 70 }, // h4
  { pattern: /\n#{5}(?!#)/g, score: 60 }, // h5
  { pattern: /\n#{6}(?!#)/g, score: 50 }, // h6
  { pattern: /\n(?:`{3,}|~{3,})/g, score: 80 }, // code-block boundary
  { pattern: /\n(?:---|\*\*\*|___)\s*\n/g, score: 60 }, // horizontal rule
  { pattern: /<\/table>/gi, score: 45, cutAfter: true, sentence: true }, // table block end
  { pattern: /\$\$/g, score: 45, cutAfter: true, sentence: true }, // display-math block end
  { pattern: /[。！？]+[”’」』】）》]?/g, score: 35, cutAfter: true, sentence: true }, // CJK sentence end
  { pattern: /[…]+[”’」』】）》]?/g, score: 30, cutAfter: true, sentence: true }, // ellipsis
  { pattern: /[；;]+[”’」』】）》]?/g, score: 28, cutAfter: true, sentence: true }, // clause end
  { pattern: /[.!?]+["')\]]?(?=\s|$)/g, score: 30, cutAfter: true, sentence: true }, // Latin sentence end
  { pattern: /\n\n+/g, score: 20 }, // paragraph boundary
  { pattern: /\n[-*]\s/g, score: 5 }, // unordered list item
  { pattern: /\n\d+\.\s/g, score: 5 }, // ordered list item
  { pattern: /\n/g, score: 1 } // bare newline
]

/** ~22% of the chunk budget — how far back from the target we hunt for a clean break. */
const WINDOW_RATIO = 0.22
/** Distance-decay strength: a break at the window edge keeps 30% of its score. */
const DECAY_FACTOR = 0.7

/**
 * Score for the user separator in structure-aware mode: paragraph-level, so
 * headings / code-fence / rule breaks still dominate while the chosen delimiter
 * is mildly preferred over plain newlines.
 */
const STRUCTURED_SEPARATOR_SCORE = 30
/** Score for the user separator in pure-delimiter mode — the primary cut. */
const DELIMITER_SEPARATOR_SCORE = 100
/**
 * Fallback delimiter chain for pure-delimiter mode, tried by descending score
 * when the user separator leaves an oversized segment (paragraph, line,
 * CJK/Latin sentence, word) before the hard character cut.
 */
const DELIMITER_FALLBACKS: ReadonlyArray<{ separator: string; score: number; sentence?: boolean }> = [
  { separator: '\n\n', score: 20 },
  { separator: '\n', score: 12 },
  { separator: '。', score: 10, sentence: true },
  { separator: '！', score: 10, sentence: true },
  { separator: '？', score: 10, sentence: true },
  { separator: '；', score: 9, sentence: true },
  { separator: '. ', score: 8, sentence: true },
  { separator: '! ', score: 8, sentence: true },
  { separator: '? ', score: 8, sentence: true },
  { separator: '; ', score: 7, sentence: true },
  { separator: ' ', score: 3 }
]

const SEPARATOR_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\' }
/** Convert a user-typed escaped delimiter (`"\\n\\n"`, `"\\t"`) into its literal characters. */
function unescapeSeparator(raw: string): string {
  return raw.replace(/\\([ntr\\])/g, (_match, code: string) => SEPARATOR_ESCAPES[code])
}

/**
 * Split `text` into overlapping, structure-aware chunks sized by token count,
 * returning each chunk's exact offsets into `text`. Replaces the upstream
 * `SentenceSplitter`, which trims and rewrites chunk text (so its output is not
 * a verbatim substring and cannot anchor reliable offsets).
 *
 * The algorithm walks the text greedily: from the current position it targets a
 * cut ~`chunkSize` tokens ahead, then snaps that cut to the highest-scoring
 * markdown break within a look-back window — avoiding preferred cuts inside a
 * code fence — and falls back to a hard character cut when no break qualifies. The next chunk
 * starts `chunkOverlap` tokens before the cut. Token budgets are converted to a
 * character budget once via the document's own chars-per-token ratio, so sizing
 * stays accurate for both Latin and CJK text without re-tokenizing each window.
 * Emitted chunks are whitespace-trimmed with offsets moved inward, so the
 * `slice(start, end) === text` invariant always holds.
 */
export function splitTextWithOffsets(text: string, options: SplitOptions): TextChunk[] {
  if (text.trim() === '') {
    return []
  }

  const chunkSize = Math.max(1, options.chunkSize)
  const chunkOverlap = Math.max(0, Math.min(options.chunkOverlap, chunkSize - 1))
  const strategy = options.strategy ?? 'structured'
  const separator = options.separator ? unescapeSeparator(options.separator) : ''

  const charsPerToken = text.length / Math.max(1, estimateTokenCount(text))
  const maxChars = Math.max(1, Math.round(chunkSize * charsPerToken))
  const overlapChars = Math.min(Math.round(chunkOverlap * charsPerToken), maxChars - 1)
  const windowChars = Math.max(1, Math.round(maxChars * WINDOW_RATIO))

  const breakPoints = scanBreakPoints(text, { strategy, separator })
  const atomicRegions = strategy === 'structured' ? findAtomicRegions(text) : []

  const chunks: TextChunk[] = []
  let cursor = 0
  while (cursor < text.length) {
    let endPos = Math.min(cursor + maxChars, text.length)
    if (endPos < text.length) {
      const cutoff = findBestCutoff(breakPoints, endPos, cursor, windowChars, atomicRegions)
      // The fallback may overshoot the target slightly to reach a sentence end.
      if (cutoff > cursor) {
        endPos = Math.min(cutoff, text.length)
      }
    }
    endPos = resolveCutOutsideRegions(endPos, cursor, atomicRegions)
    endPos = fitEndToTokenBudget(text, cursor, endPos, chunkSize, breakPoints, atomicRegions)

    const chunk = trimToChunk(text, cursor, endPos)
    if (chunk) {
      chunks.push(chunk)
    }

    if (endPos >= text.length) {
      break
    }
    let nextCursor = endPos - overlapChars
    nextCursor = resolveStartOutsideRegions(nextCursor, cursor, atomicRegions)
    const codeStart = snapCodeStart(text, nextCursor, cursor, endPos, atomicRegions)
    nextCursor = codeStart ?? snapToStartBoundary(nextCursor, endPos, breakPoints, atomicRegions)
    cursor = nextCursor > cursor ? nextCursor : endPos
  }

  return chunks
}

/**
 * Collect every candidate break, keeping the highest score at each position;
 * sorted by position. In structure-aware mode the markdown patterns drive the
 * cuts and the user separator is added as a paragraph-level break. In
 * delimiter mode the user separator is the primary break, backed by a fallback
 * delimiter chain so oversized segments still split before the hard cut.
 */
function scanBreakPoints(text: string, options: { strategy: KnowledgeChunkStrategy; separator: string }): BreakPoint[] {
  const best = new Map<number, { score: number; sentence: boolean }>()
  const consider = (pos: number, score: number, sentence = false) => {
    const existing = best.get(pos)
    if (existing === undefined || score > existing.score) {
      best.set(pos, { score, sentence })
    } else if (sentence) {
      existing.sentence = true
    }
  }

  if (options.strategy === 'structured') {
    for (const { pattern, score, cutAfter, sentence } of BREAK_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const index = match.index ?? 0
        consider(cutAfter ? index + match[0].length : index, score, sentence)
      }
    }
    addLiteralBreaks(text, options.separator, STRUCTURED_SEPARATOR_SCORE, consider)
  } else {
    addLiteralBreaks(text, options.separator, DELIMITER_SEPARATOR_SCORE, consider)
    for (const { separator, score, sentence } of DELIMITER_FALLBACKS) {
      addLiteralBreaks(text, separator, score, consider, sentence)
    }
  }

  return [...best.entries()]
    .map(([pos, value]) => ({ pos, score: value.score, sentence: value.sentence }))
    .sort((a, b) => a.pos - b.pos)
}

/**
 * Add a break after each occurrence of the literal `separator`, so the
 * delimiter stays at the end of the preceding chunk (trimmed away when it is
 * whitespace). A no-op for an empty separator.
 */
function addLiteralBreaks(
  text: string,
  separator: string,
  score: number,
  consider: (pos: number, score: number, sentence?: boolean) => void,
  sentence = false
): void {
  if (!separator) {
    return
  }
  let index = text.indexOf(separator)
  while (index !== -1) {
    consider(index + separator.length, score, sentence)
    index = text.indexOf(separator, index + separator.length)
  }
}

/** Pair backtick and tilde fences into regions; an unclosed fence extends to end of text. */
function findCodeFences(text: string): AtomicRegion[] {
  const regions: AtomicRegion[] = []
  let open: { start: number; char: string; length: number } | null = null

  // `^` catches a fence at offset zero; the other alternative catches line starts.
  for (const match of text.matchAll(/(?:^|\n)(`{3,}|~{3,})/g)) {
    const marker = match[1]
    const fenceStart = (match.index ?? 0) + (match[0].startsWith('\n') ? 1 : 0)
    const char = marker[0]
    const length = marker.length

    if (open === null) {
      open = { start: fenceStart, char, length }
    } else if (char === open.char && length >= open.length) {
      regions.push({ start: open.start, end: fenceStart + length, kind: 'code' })
      open = null
    }
  }
  if (open !== null) {
    regions.push({ start: open.start, end: text.length, kind: 'code' })
  }
  return regions
}

/** Inline code spans are masked from display/inline math detection. */
function findInlineCodeRegions(text: string, codeFences: AtomicRegion[]): AtomicRegion[] {
  const regions: AtomicRegion[] = []
  let open: { start: number; length: number } | null = null
  let regionIndex = 0

  for (const match of text.matchAll(/`+/g)) {
    const start = match.index ?? 0
    while (codeFences[regionIndex] && codeFences[regionIndex].end <= start) regionIndex += 1

    const fence = codeFences[regionIndex]
    if (fence && start >= fence.start && start < fence.end) continue

    const length = match[0].length
    if (open === null) {
      open = { start, length }
    } else if (length === open.length) {
      regions.push({ start: open.start, end: start + length, kind: 'inline-code' })
      open = null
    }
  }

  return regions
}

/** Code fences, tables, display math, and inline math must never be split. */
function findAtomicRegions(text: string): AtomicRegion[] {
  const codeFences = findCodeFences(text)
  const inlineCode = findInlineCodeRegions(text, codeFences)
  const tables = findTableRegions(text, [...codeFences, ...inlineCode])
  const displayMath = findDisplayMathRegions(text, [...codeFences, ...inlineCode, ...tables])
  const regions = [...codeFences, ...tables, ...displayMath]
  regions.push(...findInlineMathRegions(text, [...regions, ...inlineCode]))
  return mergeRegions(regions)
}

/** Pair `<table>` with its closing tag; an unclosed table extends to end of text. */
function findTableRegions(text: string, existing: AtomicRegion[]): AtomicRegion[] {
  const regions: AtomicRegion[] = []
  const open = /<table\b[^>]*>/gi
  const close = /<\/table>/gi
  let cursor = 0
  while (cursor < text.length) {
    open.lastIndex = cursor
    const openMatch = open.exec(text)
    if (!openMatch) break
    if (isInsideAtomicRegion(openMatch.index, existing)) {
      cursor = openMatch.index + openMatch[0].length
      continue
    }
    close.lastIndex = openMatch.index + openMatch[0].length
    const closeMatch = close.exec(text)
    const end = closeMatch ? closeMatch.index + closeMatch[0].length : text.length
    regions.push({ start: openMatch.index, end, kind: 'table' })
    cursor = end
  }
  return regions
}

/** Pair `$$` delimiters into display-math regions; an unclosed block extends to the end. */
function findDisplayMathRegions(text: string, existing: AtomicRegion[]): AtomicRegion[] {
  const regions: AtomicRegion[] = []
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf('$$', cursor)
    if (start === -1) break
    if (isInsideAtomicRegion(start, existing)) {
      cursor = start + 2
      continue
    }
    const end = text.indexOf('$$', start + 2)
    if (end === -1) {
      regions.push({ start, end: text.length, kind: 'math' })
      break
    }
    regions.push({ start, end: end + 2, kind: 'math' })
    cursor = end + 2
  }
  return regions
}

/** Pair single `$` delimiters outside code/table/display blocks. */
function findInlineMathRegions(text: string, existing: AtomicRegion[]): AtomicRegion[] {
  const regions: AtomicRegion[] = []
  const pattern = /(?<!\\)\$(?!\$)([^$\n]*?)(?<!\\)\$/g
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (isInsideAtomicRegion(start, existing)) continue
    regions.push({ start, end, kind: 'inline-math' })
  }
  return regions
}

function mergeRegions(regions: AtomicRegion[]): AtomicRegion[] {
  const sorted = [...regions].sort((left, right) => left.start - right.start)
  const merged: AtomicRegion[] = []
  for (const region of sorted) {
    const last = merged.at(-1)
    // Touching regions are independent: `end` is exclusive, so only overlap merges.
    if (last && region.start < last.end) {
      last.end = Math.max(last.end, region.end)
      if (region.kind === 'code') last.kind = 'code'
    } else {
      merged.push({ ...region })
    }
  }
  return merged
}

/** Move a cut out of an atomic block: before it when possible, otherwise after it. */
function resolveCutOutsideRegions(pos: number, cursor: number, regions: AtomicRegion[]): number {
  const region = regions.find((candidate) => pos > candidate.start && pos < candidate.end)
  if (!region) return pos
  return region.start > cursor ? region.start : region.end
}

/** Move an overlap start out of a non-code atomic block so the next chunk begins after it. */
function resolveStartOutsideRegions(pos: number, cursor: number, regions: AtomicRegion[]): number {
  const region = regions.find((candidate) => pos > candidate.start && pos < candidate.end)
  if (!region) return pos
  // Code blocks may be cut internally to respect the token budget; keep the start.
  if (region.kind === 'code') return pos
  return region.end > cursor ? region.end : pos
}

/** Start an overlap inside a split code block on the preceding line boundary. */
function snapCodeStart(
  text: string,
  pos: number,
  cursor: number,
  endPos: number,
  regions: AtomicRegion[]
): number | null {
  const region = regions.find((candidate) => candidate.kind === 'code' && pos > candidate.start && pos < candidate.end)
  if (!region) return null

  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  if (lineStart === pos) return lineStart > cursor ? lineStart : null

  const previousNewline = lineStart - 1
  return previousNewline >= cursor && lineStart < endPos ? lineStart : null
}

/**
 * Snap an overlap start forward to the next sentence/structural boundary. The
 * first chunk of the overlap stays whole; when no boundary fits before the cut,
 * the next chunk starts at the cut and overlap is dropped.
 */
function snapToStartBoundary(pos: number, endPos: number, breakPoints: BreakPoint[], regions: AtomicRegion[]): number {
  for (const bp of breakPoints) {
    if (bp.pos < pos) continue
    if (bp.pos >= endPos) break
    if (!bp.sentence && bp.score < 20) continue
    if (isInsideAtomicRegion(bp.pos, regions)) continue
    return bp.pos
  }

  for (const region of regions) {
    if (region.kind === 'code') continue
    // Only snap to a block end when the start is already inside that block;
    // otherwise the block would be skipped entirely.
    if (region.start < pos && region.end >= pos && region.end < endPos) return region.end
  }

  return endPos
}

/**
 * The global chars-per-token ratio is inaccurate for formula-heavy text. When
 * the selected chunk exceeds the token budget, shrink it to the largest prefix
 * that fits and prefer the nearest sentence/structural boundary within it.
 */
function fitEndToTokenBudget(
  text: string,
  start: number,
  end: number,
  maxTokens: number,
  breakPoints: BreakPoint[],
  regions: AtomicRegion[]
): number {
  if (end <= start + 1) {
    return end
  }
  if (estimateTokenCount(text.slice(start, end)) <= maxTokens) {
    return end
  }

  let low = start + 1
  let high = end
  let best = start + 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (estimateTokenCount(text.slice(start, mid)) <= maxTokens) {
      best = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  let boundary = -1
  for (const bp of breakPoints) {
    if (bp.pos > best) break
    if (bp.pos <= start) continue
    if (!bp.sentence && bp.score < 20) continue
    if (isInsideAtomicRegion(bp.pos, regions)) continue
    boundary = bp.pos
  }
  if (boundary > start) {
    return boundary
  }

  const region = regions.find((candidate) => best > candidate.start && best < candidate.end)
  if (region) {
    // A code block that cannot fit is cut at a line boundary; otherwise keep
    // small blocks and math/table blocks atomic.
    if (region.kind === 'code') {
      const lineBreak = text.lastIndexOf('\n', best - 1)
      return lineBreak > start ? lineBreak + 1 : best
    }
    return region.start > start ? region.start : region.end
  }
  return best
}

function isInsideAtomicRegion(pos: number, regions: AtomicRegion[]): boolean {
  return regions.some((region) => pos > region.start && pos < region.end)
}

/**
 * Pick the cut position: the break with the highest distance-decayed score in
 * `[target - windowChars, target]`, skipping any inside an atomic block. When
 * the window has no break, fall back to the nearest sentence/block end so a
 * punctuation boundary is not skipped just because it sits farther back.
 */
function findBestCutoff(
  breakPoints: BreakPoint[],
  target: number,
  cursor: number,
  windowChars: number,
  regions: AtomicRegion[]
): number {
  const windowStart = target - windowChars
  let bestScore = -1
  let bestPos = target
  let found = false
  for (const bp of breakPoints) {
    if (bp.pos < windowStart) continue
    if (bp.pos > target) break // sorted by position
    if (isInsideAtomicRegion(bp.pos, regions)) continue

    const normalizedDistance = (target - bp.pos) / windowChars
    const score = bp.score * (1 - normalizedDistance * normalizedDistance * DECAY_FACTOR)
    if (score > bestScore) {
      bestScore = score
      bestPos = bp.pos
      found = true
    }
  }
  return found
    ? bestPos
    : findFallbackCutoff(
        breakPoints,
        target,
        cursor,
        Math.max(cursor, target - Math.round((windowChars / WINDOW_RATIO) * 0.5)),
        Math.max(16, windowChars),
        regions
      )
}

/**
 * The 22% window can miss a sentence end that sits just before the target.
 * Prefer the nearest sentence/block end at or before the target, then allow a
 * small overshoot to the next one; otherwise the caller hard-cuts at the target.
 */
function findFallbackCutoff(
  breakPoints: BreakPoint[],
  target: number,
  cursor: number,
  minPos: number,
  maxOvershoot: number,
  regions: AtomicRegion[]
): number {
  let before = -1
  for (const bp of breakPoints) {
    if (bp.pos > target) break
    if (bp.pos < minPos || bp.pos <= cursor || (!bp.sentence && bp.score < 20)) continue
    if (isInsideAtomicRegion(bp.pos, regions)) continue
    before = bp.pos
  }
  if (before > cursor) {
    return before
  }

  for (const bp of breakPoints) {
    if (bp.pos <= target) continue
    if (bp.pos > target + maxOvershoot) break
    if (!bp.sentence && bp.score < 20) continue
    if (isInsideAtomicRegion(bp.pos, regions)) continue
    return bp.pos
  }

  return target
}

/**
 * Trim both edges of [start, end) inward, keeping offsets aligned to the slice.
 * Drops leading/trailing whitespace while preserving the verbatim slice invariant.
 */
function trimToChunk(text: string, start: number, end: number): TextChunk | null {
  let trimmedStart = start
  let trimmedEnd = end
  while (trimmedStart < trimmedEnd && isWhitespace(text[trimmedStart])) {
    trimmedStart += 1
  }
  while (trimmedEnd > trimmedStart && isWhitespace(text[trimmedEnd - 1])) {
    trimmedEnd -= 1
  }
  if (trimmedStart >= trimmedEnd) {
    return null
  }
  const body = text.slice(trimmedStart, trimmedEnd)
  return { text: body, start: trimmedStart, end: trimmedEnd }
}

function isWhitespace(char: string): boolean {
  return char.trim() === ''
}
