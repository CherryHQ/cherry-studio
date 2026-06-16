import { estimateTokenCount } from 'tokenx'

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
}

/** A candidate place to cut, scored by how clean a boundary it is. */
interface BreakPoint {
  pos: number
  score: number
}

/** A `\`\`\`` … `\`\`\`` region where preferred break points should be ignored. */
interface CodeFenceRegion {
  start: number
  end: number
}

/**
 * Markdown break patterns scored by boundary quality (higher = better place to
 * split). Headings dominate, then code-block edges and rules, then paragraph,
 * list and bare-newline fallbacks. Adapted from the structure-aware
 * chunker design used by qmd / MinerU Document Explorer — structural breaks
 * yield far more coherent retrieval units than fixed-size windows, while still
 * cutting at exact source offsets. Each pattern's match index is the cut point.
 */
const BREAK_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /\n#{1}(?!#)/g, score: 100 }, // h1
  { pattern: /\n#{2}(?!#)/g, score: 90 }, // h2
  { pattern: /\n#{3}(?!#)/g, score: 80 }, // h3
  { pattern: /\n#{4}(?!#)/g, score: 70 }, // h4
  { pattern: /\n#{5}(?!#)/g, score: 60 }, // h5
  { pattern: /\n#{6}(?!#)/g, score: 50 }, // h6
  { pattern: /\n```/g, score: 80 }, // code-block boundary
  { pattern: /\n(?:---|\*\*\*|___)\s*\n/g, score: 60 }, // horizontal rule
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

  const charsPerToken = text.length / Math.max(1, estimateTokenCount(text))
  const maxChars = Math.max(1, Math.round(chunkSize * charsPerToken))
  const overlapChars = Math.min(Math.round(chunkOverlap * charsPerToken), maxChars - 1)
  const windowChars = Math.max(1, Math.round(maxChars * WINDOW_RATIO))

  const breakPoints = scanBreakPoints(text)
  const codeFences = findCodeFences(text)

  const chunks: TextChunk[] = []
  let cursor = 0
  while (cursor < text.length) {
    let endPos = Math.min(cursor + maxChars, text.length)
    if (endPos < text.length) {
      const cutoff = findBestCutoff(breakPoints, endPos, windowChars, codeFences)
      if (cutoff > cursor && cutoff <= endPos) {
        endPos = cutoff
      }
    }

    const chunk = trimToChunk(text, cursor, endPos)
    if (chunk) {
      chunks.push(chunk)
    }

    if (endPos >= text.length) {
      break
    }
    const nextCursor = endPos - overlapChars
    cursor = nextCursor > cursor ? nextCursor : endPos
  }

  return chunks
}

/** Collect every candidate break, keeping the highest score at each position; sorted by position. */
function scanBreakPoints(text: string): BreakPoint[] {
  const best = new Map<number, number>()
  const consider = (pos: number, score: number) => {
    const existing = best.get(pos)
    if (existing === undefined || score > existing) {
      best.set(pos, score)
    }
  }

  for (const { pattern, score } of BREAK_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      consider(match.index, score)
    }
  }
  return [...best.entries()].map(([pos, score]) => ({ pos, score })).sort((a, b) => a.pos - b.pos)
}

/** Pair up `\`\`\`` fences into regions; an unclosed fence extends to end of text. */
function findCodeFences(text: string): CodeFenceRegion[] {
  const regions: CodeFenceRegion[] = []
  let open: number | null = null
  for (const match of text.matchAll(/\n```/g)) {
    if (open === null) {
      open = match.index
    } else {
      regions.push({ start: open, end: match.index + match[0].length })
      open = null
    }
  }
  if (open !== null) {
    regions.push({ start: open, end: text.length })
  }
  return regions
}

function isInsideCodeFence(pos: number, fences: CodeFenceRegion[]): boolean {
  return fences.some((fence) => pos > fence.start && pos < fence.end)
}

/**
 * Pick the cut position: the break with the highest distance-decayed score in
 * `[target - windowChars, target]`, skipping any inside a code fence. Returns
 * `target` unchanged when no break qualifies (the caller then hard-cuts there).
 */
function findBestCutoff(
  breakPoints: BreakPoint[],
  target: number,
  windowChars: number,
  codeFences: CodeFenceRegion[]
): number {
  const windowStart = target - windowChars
  let bestScore = -1
  let bestPos = target
  for (const bp of breakPoints) {
    if (bp.pos < windowStart) continue
    if (bp.pos > target) break // sorted by position
    if (isInsideCodeFence(bp.pos, codeFences)) continue

    const normalizedDistance = (target - bp.pos) / windowChars
    const score = bp.score * (1 - normalizedDistance * normalizedDistance * DECAY_FACTOR)
    if (score > bestScore) {
      bestScore = score
      bestPos = bp.pos
    }
  }
  return bestPos
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
