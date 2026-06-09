import { buildKeywordRegexes, type KeywordMatchMode } from './keywordSearch'

const SEARCH_SNIPPET_CONTEXT_LINES = 1
const SEARCH_SNIPPET_MAX_LINES = 12
const SEARCH_SNIPPET_MAX_LINE_LENGTH = 160
const SEARCH_SNIPPET_LINE_FRAGMENT_RADIUS = 40
const SEARCH_SNIPPET_MAX_LINE_FRAGMENTS = 3

export function stripMarkdownFormatting(text: string) {
  return text
    .replace(/```(?:[^\n]*\n)?([\s\S]*?)```/g, '$1')
    .replace(/!\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/#+\s/g, '')
    .replace(/<[^>]*>/g, '')
}

const normalizeText = (text: string) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

function mergeRanges(ranges: Array<[number, number]>) {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (!last || range[0] > last[1] + 1) {
      merged.push([range[0], range[1]])
      continue
    }
    last[1] = Math.max(last[1], range[1])
  }
  return merged
}

function buildLineSnippet(line: string, regexes: RegExp[]) {
  if (line.length <= SEARCH_SNIPPET_MAX_LINE_LENGTH) {
    return line
  }

  const matchRanges: Array<[number, number]> = []
  for (const regex of regexes) {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(line)) !== null) {
      matchRanges.push([match.index, match.index + match[0].length])
      if (match[0].length === 0) {
        regex.lastIndex += 1
      }
    }
  }

  if (matchRanges.length === 0) {
    return `${line.slice(0, SEARCH_SNIPPET_MAX_LINE_LENGTH)}...`
  }

  const expandedRanges: Array<[number, number]> = matchRanges.map(([start, end]) => [
    Math.max(0, start - SEARCH_SNIPPET_LINE_FRAGMENT_RADIUS),
    Math.min(line.length, end + SEARCH_SNIPPET_LINE_FRAGMENT_RADIUS)
  ])
  const mergedRanges = mergeRanges(expandedRanges)
  const limitedRanges = mergedRanges.slice(0, SEARCH_SNIPPET_MAX_LINE_FRAGMENTS)

  let result = limitedRanges.map(([start, end]) => line.slice(start, end)).join(' ... ')
  if (limitedRanges[0][0] > 0) {
    result = `...${result}`
  }
  if (limitedRanges[limitedRanges.length - 1][1] < line.length) {
    result = `${result}...`
  }
  if (mergedRanges.length > SEARCH_SNIPPET_MAX_LINE_FRAGMENTS) {
    result = `${result}...`
  }
  if (result.length > SEARCH_SNIPPET_MAX_LINE_LENGTH) {
    result = `${result.slice(0, SEARCH_SNIPPET_MAX_LINE_LENGTH)}...`
  }
  return result
}

export function buildSearchSnippet(text: string, terms: string[], matchMode: KeywordMatchMode) {
  const normalized = normalizeText(stripMarkdownFormatting(text))
  const lines = normalized.split('\n')
  if (lines.length === 0) {
    return ''
  }

  const nonEmptyTerms = terms.filter((term) => term.length > 0)
  const regexes = buildKeywordRegexes(nonEmptyTerms, { matchMode, flags: 'gi' })
  const matchedLineIndexes: number[] = []

  if (regexes.length > 0) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const isMatch = regexes.some((regex) => {
        regex.lastIndex = 0
        return regex.test(line)
      })
      if (isMatch) {
        matchedLineIndexes.push(i)
      }
    }
  }

  const ranges: Array<[number, number]> =
    matchedLineIndexes.length > 0
      ? mergeRanges(
          matchedLineIndexes.map((index) => [
            Math.max(0, index - SEARCH_SNIPPET_CONTEXT_LINES),
            Math.min(lines.length - 1, index + SEARCH_SNIPPET_CONTEXT_LINES)
          ])
        )
      : [[0, Math.min(lines.length - 1, SEARCH_SNIPPET_MAX_LINES - 1)]]

  const outputLines: string[] = []
  let truncated = false

  if (ranges[0][0] > 0) {
    outputLines.push('...')
  }

  for (const [start, end] of ranges) {
    if (outputLines.length >= SEARCH_SNIPPET_MAX_LINES) {
      truncated = true
      break
    }
    if (outputLines.length > 0 && outputLines[outputLines.length - 1] !== '...') {
      outputLines.push('...')
    }
    for (let i = start; i <= end; i += 1) {
      if (outputLines.length >= SEARCH_SNIPPET_MAX_LINES) {
        truncated = true
        break
      }
      outputLines.push(buildLineSnippet(lines[i], regexes))
    }
    if (truncated) {
      break
    }
  }

  if ((truncated || ranges[ranges.length - 1][1] < lines.length - 1) && outputLines.at(-1) !== '...') {
    outputLines.push('...')
  }

  return outputLines.join('\n')
}
