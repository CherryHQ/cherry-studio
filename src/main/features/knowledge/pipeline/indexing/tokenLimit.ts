import type { ChunkedKnowledgeContent, KnowledgeContentChunk } from './chunk'

export interface TokenLimitRefineOptions {
  maxTokens: number
  overlapTokens: number
  countTokens: (text: string) => Promise<number>
}

interface TextRange {
  start: number
  end: number
  text: string
}

const BOUNDARY_MIN_RATIO = 0.5
const PREFERRED_BOUNDARIES = ['\n\n', '\n', '。', '！', '？', '. ', '! ', '? ', '；', '; ', '，', ', ', ' ']

export async function refineChunksByTokenLimit(
  chunked: ChunkedKnowledgeContent,
  options: TokenLimitRefineOptions
): Promise<ChunkedKnowledgeContent> {
  const maxTokens = Math.max(1, Math.floor(options.maxTokens))
  const overlapTokens = Math.max(0, Math.min(Math.floor(options.overlapTokens), maxTokens - 1))
  const chunks: KnowledgeContentChunk[] = []

  const pushChunk = (range: TextRange) => {
    chunks.push({
      unitIndex: chunks.length,
      charStart: range.start,
      charEnd: range.end,
      text: range.text
    })
  }

  for (const chunk of chunked.chunks) {
    if ((await options.countTokens(chunk.text)) <= maxTokens) {
      pushChunk({ start: chunk.charStart, end: chunk.charEnd, text: chunk.text })
      continue
    }

    for (const range of await splitChunkByTokenLimit(
      chunked.contentText,
      chunk,
      maxTokens,
      overlapTokens,
      options.countTokens
    )) {
      pushChunk(range)
    }
  }

  return { contentText: chunked.contentText, chunks }
}

async function splitChunkByTokenLimit(
  contentText: string,
  chunk: KnowledgeContentChunk,
  maxTokens: number,
  overlapTokens: number,
  countTokens: (text: string) => Promise<number>
): Promise<TextRange[]> {
  const ranges: TextRange[] = []
  let cursor = chunk.charStart

  while (cursor < chunk.charEnd) {
    const end = await findTokenLimitedEnd(contentText, cursor, chunk.charEnd, maxTokens, countTokens)
    const range = trimRange(contentText, cursor, end)
    if (range) {
      ranges.push(range)
    }

    if (end >= chunk.charEnd) {
      break
    }

    const nextCursor =
      range && overlapTokens > 0
        ? await findOverlapStart(contentText, range.start, range.end, overlapTokens, countTokens)
        : end
    cursor = nextCursor > cursor ? nextCursor : end
  }

  return ranges
}

async function findTokenLimitedEnd(
  contentText: string,
  start: number,
  limit: number,
  maxTokens: number,
  countTokens: (text: string) => Promise<number>
): Promise<number> {
  const full = trimRange(contentText, start, limit)
  if (full && (await countTokens(full.text)) <= maxTokens) {
    return limit
  }

  let low = start + 1
  let high = limit
  let best = start + 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = trimRange(contentText, start, mid)
    if (!candidate || (await countTokens(candidate.text)) <= maxTokens) {
      best = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return findPreferredBoundary(contentText, start, best)
}

function findPreferredBoundary(contentText: string, start: number, hardEnd: number): number {
  const minEnd = start + Math.max(1, Math.floor((hardEnd - start) * BOUNDARY_MIN_RATIO))
  for (const boundary of PREFERRED_BOUNDARIES) {
    const index = contentText.lastIndexOf(boundary, hardEnd - boundary.length)
    if (index >= minEnd && index >= start) {
      return index + boundary.length
    }
  }
  return hardEnd
}

async function findOverlapStart(
  contentText: string,
  start: number,
  end: number,
  overlapTokens: number,
  countTokens: (text: string) => Promise<number>
): Promise<number> {
  let low = start
  let high = end
  let best = end
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = trimRange(contentText, mid, end)
    if (!candidate || (await countTokens(candidate.text)) <= overlapTokens) {
      best = mid
      high = mid - 1
    } else {
      low = mid + 1
    }
  }
  return best
}

function trimRange(contentText: string, start: number, end: number): TextRange | null {
  let trimmedStart = start
  let trimmedEnd = end
  while (trimmedStart < trimmedEnd && /\s/.test(contentText[trimmedStart])) {
    trimmedStart += 1
  }
  while (trimmedEnd > trimmedStart && /\s/.test(contentText[trimmedEnd - 1])) {
    trimmedEnd -= 1
  }
  if (trimmedStart >= trimmedEnd) {
    return null
  }
  return {
    start: trimmedStart,
    end: trimmedEnd,
    text: contentText.slice(trimmedStart, trimmedEnd)
  }
}
