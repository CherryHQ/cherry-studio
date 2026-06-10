const FENCED_CODE_START_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/

interface CodeBlockProgress {
  language: string
  lineCount: number
  charCount: number
}

type FormatCodeBlockProgress = (progress: CodeBlockProgress) => string

interface ActiveFence {
  char: string
  minLength: number
  language: string
  lineCount: number
  charCount: number
  placeholderIndex: number
}

function isClosingFenceLine(source: string, start: number, end: number, fenceChar: string, minLength: number): boolean {
  let index = start
  let spaces = 0

  while (index < end && source[index] === ' ' && spaces < 4) {
    index++
    spaces++
  }

  if (spaces > 3) {
    return false
  }

  let markerLength = 0
  while (index < end && source[index] === fenceChar) {
    index++
    markerLength++
  }

  if (markerLength < minLength) {
    return false
  }

  while (index < end && (source[index] === ' ' || source[index] === '\t')) {
    index++
  }

  return index === end
}

function getFenceLanguage(meta: string, fallback: string): string {
  return meta.trim().split(/\s+/)[0] || fallback
}

function formatCodeBlockPlaceholder(fence: ActiveFence, formatCodeBlockProgress: FormatCodeBlockProgress): string {
  return formatCodeBlockProgress({
    language: fence.language,
    lineCount: fence.lineCount,
    charCount: fence.charCount
  })
}

export function createStreamingTextProjection(
  content: string,
  formatCodeBlockProgress: FormatCodeBlockProgress
): string {
  if (!content.includes('```') && !content.includes('~~~')) {
    return content
  }

  const projected: string[] = []
  let position = 0
  let activeFence: ActiveFence | null = null

  while (position <= content.length) {
    const nextLineBreak = content.indexOf('\n', position)
    const lineEnd = nextLineBreak === -1 ? content.length : nextLineBreak
    const hasLineBreak = nextLineBreak !== -1

    if (!activeFence) {
      const line = content.slice(position, lineEnd)
      const match = line.match(FENCED_CODE_START_RE)

      if (match) {
        const placeholderIndex = projected.length
        activeFence = {
          char: match[2][0],
          minLength: match[2].length,
          language: getFenceLanguage(match[3], 'code'),
          lineCount: 0,
          charCount: 0,
          placeholderIndex
        }
        projected.push(formatCodeBlockPlaceholder(activeFence, formatCodeBlockProgress))
      } else {
        projected.push(line)
      }

      if (hasLineBreak) {
        projected.push('\n')
      }
    } else {
      const fence = activeFence
      if (isClosingFenceLine(content, position, lineEnd, fence.char, fence.minLength)) {
        activeFence = null
      } else {
        fence.lineCount += 1
        fence.charCount += lineEnd - position + (hasLineBreak ? 1 : 0)
        projected[fence.placeholderIndex] = formatCodeBlockPlaceholder(fence, formatCodeBlockProgress)
      }
    }

    if (!hasLineBreak) {
      break
    }

    position = lineEnd + 1
  }

  if (projected[projected.length - 1] === '\n') {
    projected.pop()
  }

  return projected.join('')
}
