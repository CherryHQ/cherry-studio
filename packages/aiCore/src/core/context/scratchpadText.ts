/** Model scratchpad wrappers named in compaction prompts and observed in leaked transcripts. */
export const MODEL_SCRATCHPAD_TAG_NAMES = ['analysis', 'assessment', 'thinking'] as const

const MODEL_SCRATCHPAD_TAG_SET = new Set<string>(MODEL_SCRATCHPAD_TAG_NAMES)

type ParsedOpeningTag = {
  tagName: string
  opener: string
  isSelfClosing: boolean
}

/** Deterministic opener scan — avoids catastrophic backtracking from overlapping attribute regexes. */
function parseOpeningTagAt(text: string, offset: number): ParsedOpeningTag | null {
  if (text[offset] !== '<') return null
  const start = offset
  let i = offset + 1
  const nameMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(text.slice(i))
  if (!nameMatch) return null
  const tagName = nameMatch[0]
  i += nameMatch[0].length

  while (i < text.length) {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) {
      i++
    }
    if (i >= text.length) return null

    if (text[i] === '>') {
      i++
      return { tagName, opener: text.slice(start, i), isSelfClosing: false }
    }
    if (text[i] === '/') {
      if (i + 1 < text.length && text[i + 1] === '>') {
        i += 2
        return { tagName, opener: text.slice(start, i), isSelfClosing: true }
      }
      return null
    }

    const attrNameMatch = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*/.exec(text.slice(i))
    if (!attrNameMatch) return null
    i += attrNameMatch[0].length

    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
    if (i < text.length && text[i] === '=') {
      i++
      while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
      if (i >= text.length) return null
      const quote = text[i]
      if (quote === '"' || quote === "'") {
        i++
        while (i < text.length && text[i] !== quote) i++
        if (i >= text.length) return null
        i++
      } else {
        while (i < text.length && text[i] !== ' ' && text[i] !== '\t' && text[i] !== '>' && text[i] !== '/') {
          i++
        }
      }
    }
  }
  return null
}

function parseLeadingOpeningTag(text: string): ParsedOpeningTag | null {
  const leadingWhitespace = text.match(/^\s*/)?.[0].length ?? 0
  const parsed = parseOpeningTagAt(text, leadingWhitespace)
  if (!parsed) return null
  const afterOpener = leadingWhitespace + parsed.opener.length
  if (afterOpener > text.length) return null
  return parsed
}
const CODE_FENCE_PLACEHOLDER_PREFIX = '\uE000CODE_FENCE_'
const CODE_FENCE_PLACEHOLDER_SUFFIX = '\uE001'
const CODE_FENCE_PLACEHOLDER = new RegExp(`${CODE_FENCE_PLACEHOLDER_PREFIX}(\\d+)${CODE_FENCE_PLACEHOLDER_SUFFIX}`, 'g')
const INLINE_CODE_PLACEHOLDER_PREFIX = '\uE000INLINE_CODE_'
const INLINE_CODE_PLACEHOLDER_SUFFIX = '\uE001'
const INLINE_CODE_PLACEHOLDER = new RegExp(
  `${INLINE_CODE_PLACEHOLDER_PREFIX}(\\d+)${INLINE_CODE_PLACEHOLDER_SUFFIX}`,
  'g'
)

function isValidFenceLinePrefix(prefix: string): boolean {
  let i = 0
  while (i < prefix.length) {
    if (prefix[i] === '>') {
      i++
      if (i < prefix.length && prefix[i] === ' ') i++
      continue
    }
    if (
      (prefix[i] === '-' || prefix[i] === '*' || prefix[i] === '+') &&
      i + 1 < prefix.length &&
      prefix[i + 1] === ' '
    ) {
      i += 2
      continue
    }
    if (prefix[i] >= '0' && prefix[i] <= '9') {
      while (i < prefix.length && prefix[i] >= '0' && prefix[i] <= '9') i++
      if (i + 1 < prefix.length && (prefix[i] === '.' || prefix[i] === ')') && prefix[i + 1] === ' ') {
        i += 2
        continue
      }
      return false
    }
    if (prefix[i] === ' ') {
      let spaces = 0
      while (i < prefix.length && prefix[i] === ' ' && spaces < 3) {
        i++
        spaces++
      }
      if (spaces === 0) return false
      continue
    }
    return false
  }
  return true
}

function fenceLinePrefixStart(text: string, fenceMarkerIndex: number): number {
  const lineStart = text.lastIndexOf('\n', fenceMarkerIndex - 1) + 1
  const prefix = text.slice(lineStart, fenceMarkerIndex)
  if (prefix.length > 0 && isValidFenceLinePrefix(prefix)) {
    return lineStart
  }
  return fenceMarkerIndex
}

function isInsideInlineCodeOnLine(text: string, markerStart: number): boolean {
  const lineStart = text.lastIndexOf('\n', markerStart - 1) + 1
  const lineSlice = text.slice(lineStart, markerStart)
  let i = 0
  while (i < lineSlice.length) {
    if (lineSlice[i] !== '`') {
      i++
      continue
    }
    let run = 0
    while (i < lineSlice.length && lineSlice[i] === '`') {
      run++
      i++
    }
    let j = i
    let closed = false
    while (j < lineSlice.length) {
      if (lineSlice[j] !== '`') {
        j++
        continue
      }
      let closeRun = 0
      const closeStart = j
      while (j < lineSlice.length && lineSlice[j] === '`') {
        closeRun++
        j++
      }
      if (closeRun === run) {
        closed = true
        i = j
        break
      }
      j = closeStart + 1
    }
    if (!closed) {
      return true
    }
  }
  return false
}

function lineEndAfter(text: string, from: number): number {
  const lf = text.indexOf('\n', from)
  if (lf === -1) return text.length
  if (text[lf] === '\r' && lf + 1 < text.length && text[lf + 1] === '\n') {
    return lf + 2
  }
  return lf + 1
}

function findCodeFenceClose(text: string, searchFrom: number, fenceChar: string, fenceLen: number): number {
  let pos = searchFrom
  while (pos < text.length) {
    const rel = text.slice(pos).search(/[`~]{3,}/)
    if (rel === -1) return -1
    const markerStart = pos + rel
    if (!isCodeFenceMarkerAtLineStart(text, markerStart)) {
      pos = markerStart + 1
      continue
    }
    const match = text.slice(markerStart).match(/^([`~])\1{2,}/)
    if (!match || match[1] !== fenceChar || match[0].length < fenceLen) {
      pos = markerStart + 1
      continue
    }
    return lineEndAfter(text, markerStart)
  }
  return -1
}

function maskInlineCodeSpans(text: string): { text: string; spans: string[] } {
  const spans: string[] = []
  let out = ''
  let pos = 0

  while (pos < text.length) {
    if (text[pos] !== '`') {
      const next = text.indexOf('`', pos)
      if (next === -1) {
        out += text.slice(pos)
        break
      }
      out += text.slice(pos, next)
      pos = next
      continue
    }

    let run = 0
    let i = pos
    while (i < text.length && text[i] === '`') {
      run++
      i++
    }
    const contentStart = i
    let j = contentStart
    let closedAt = -1
    while (j < text.length) {
      if (text[j] !== '`') {
        j++
        continue
      }
      let closeRun = 0
      const closeStart = j
      while (j < text.length && text[j] === '`') {
        closeRun++
        j++
      }
      if (closeRun === run) {
        closedAt = j
        break
      }
      j = closeStart + 1
    }

    if (closedAt === -1) {
      out += text[pos]
      pos++
      continue
    }

    const span = text.slice(pos, closedAt)
    spans.push(span)
    out += `${INLINE_CODE_PLACEHOLDER_PREFIX}${spans.length - 1}${INLINE_CODE_PLACEHOLDER_SUFFIX}`
    pos = closedAt
  }

  return { text: out, spans }
}

function unmaskInlineCodeSpans(text: string, spans: string[]): string {
  return text.replace(INLINE_CODE_PLACEHOLDER, (_, index) => spans[Number(index)] ?? '')
}

function isCodeFenceMarkerAtLineStart(text: string, markerStart: number): boolean {
  const lineStart = text.lastIndexOf('\n', markerStart - 1) + 1
  const prefix = text.slice(lineStart, markerStart)
  if (isValidFenceLinePrefix(prefix)) {
    return true
  }
  if (isInsideInlineCodeOnLine(text, markerStart)) {
    return false
  }
  return /<\/(?:analysis|assessment|thinking)\s*>$/i.test(prefix)
}

function maskCodeFences(text: string): { text: string; fences: string[] } {
  const fences: string[] = []
  let out = ''
  let pos = 0

  while (pos < text.length) {
    const rel = text.slice(pos).search(/[`~]{3,}/)
    if (rel === -1) {
      out += text.slice(pos)
      break
    }
    const markerStart = pos + rel
    if (!isCodeFenceMarkerAtLineStart(text, markerStart)) {
      out += text.slice(pos, markerStart + 1)
      pos = markerStart + 1
      continue
    }
    const fenceStart = fenceLinePrefixStart(text, markerStart)
    out += text.slice(pos, fenceStart)
    const openMatch = text.slice(markerStart).match(/^([`~])\1{2,}/)
    if (!openMatch) {
      out += text[fenceStart]
      pos = fenceStart + 1
      continue
    }

    const fenceChar = openMatch[1]
    const fenceLen = openMatch[0].length
    const afterOpen = markerStart + openMatch[0].length
    const closeEnd = findCodeFenceClose(text, afterOpen, fenceChar, fenceLen)
    if (closeEnd === -1) {
      const fenceEnd = text.length
      fences.push(text.slice(fenceStart, fenceEnd))
      out += `${CODE_FENCE_PLACEHOLDER_PREFIX}${fences.length - 1}${CODE_FENCE_PLACEHOLDER_SUFFIX}`
      pos = fenceEnd
      continue
    }

    const fenceEnd = closeEnd
    fences.push(text.slice(fenceStart, fenceEnd))
    out += `${CODE_FENCE_PLACEHOLDER_PREFIX}${fences.length - 1}${CODE_FENCE_PLACEHOLDER_SUFFIX}`
    pos = fenceEnd
  }

  return { text: out, fences }
}

function unmaskCodeFences(text: string, fences: string[]): string {
  return text.replace(CODE_FENCE_PLACEHOLDER, (_, index) => fences[Number(index)] ?? '')
}

/** True when a line ends with 1–2 backtick/tilde characters that may complete a fence on the next delta. */
export function textEndsWithPartialFenceMarker(text: string): boolean {
  return /(?:^|[\r\n])[^\r\n]*[`~]{1,2}$/.test(text)
}

/** True when scratchpad filtering should wait for more stream input before stripping. */
export function shouldDeferScratchpadStripping(text: string): boolean {
  return textHasUnclosedCodeFence(text) || textEndsWithPartialFenceMarker(text)
}

/** True when the text opens a fenced code block that has no closing delimiter yet. */
export function textHasUnclosedCodeFence(text: string): boolean {
  let pos = 0
  while (pos < text.length) {
    const rel = text.slice(pos).search(/[`~]{3,}/)
    if (rel === -1) return false
    const markerStart = pos + rel
    if (!isCodeFenceMarkerAtLineStart(text, markerStart)) {
      pos = markerStart + 1
      continue
    }
    const openMatch = text.slice(markerStart).match(/^([`~])\1{2,}/)
    if (!openMatch) {
      pos = markerStart + 1
      continue
    }

    const fenceChar = openMatch[1]
    const fenceLen = openMatch[0].length
    const afterOpen = markerStart + openMatch[0].length
    const closeEnd = findCodeFenceClose(text, afterOpen, fenceChar, fenceLen)
    if (closeEnd === -1) return true
    pos = closeEnd
  }
  return false
}

function isModelScratchpadTagName(tag: string): boolean {
  return MODEL_SCRATCHPAD_TAG_SET.has(tag.toLowerCase())
}

export function textStartsWithModelScratchpadTag(text: string): boolean {
  const parsed = parseLeadingOpeningTag(text)
  if (!parsed || parsed.isSelfClosing || !isModelScratchpadTagName(parsed.tagName)) {
    return false
  }
  return true
}

/** Opening markup that is not a known model scratchpad wrapper (e.g. `<p>`, `<thinking-note>`). */
export function textStartsWithNonScratchpadOpeningTag(text: string): boolean {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('<') || !trimmed.includes('>')) {
    return false
  }
  if (textStartsWithModelScratchpadTag(trimmed)) {
    return false
  }
  const parsed = parseLeadingOpeningTag(trimmed)
  return parsed ? !parsed.isSelfClosing : false
}

/** Strips known scratchpad wrappers without touching fenced code blocks. */
export function stripKnownModelScratchpadBlocksPreservingCodeFences(raw: string): string {
  const { text: fenceMasked, fences } = maskCodeFences(raw)
  const { text: inlineMasked, spans } = maskInlineCodeSpans(fenceMasked)
  const stripped = stripKnownModelScratchpadBlocks(inlineMasked)
  const withInline = unmaskInlineCodeSpans(stripped, spans)
  return unmaskCodeFences(withInline, fences)
}

function findScratchpadBlockEnd(text: string, openIndex: number, tagName: string, openerLength: number): number {
  const afterOpen = openIndex + openerLength
  const closePattern = new RegExp(`</${tagName}\\s*>`, 'i')
  const closeMatch = closePattern.exec(text.slice(afterOpen))
  if (!closeMatch || closeMatch.index === undefined) return -1
  return afterOpen + closeMatch.index + closeMatch[0].length
}

/** Strips only known model scratchpad wrappers; leaves other markup intact. */
export function stripKnownModelScratchpadBlocks(raw: string): string {
  let out = raw
  let changed = true
  while (changed) {
    changed = false
    let searchFrom = 0
    while (searchFrom < out.length) {
      const openIndex = out.indexOf('<', searchFrom)
      if (openIndex === -1) break
      const parsed = parseOpeningTagAt(out, openIndex)
      if (!parsed || parsed.isSelfClosing || !isModelScratchpadTagName(parsed.tagName)) {
        searchFrom = openIndex + 1
        continue
      }
      const end = findScratchpadBlockEnd(out, openIndex, parsed.tagName, parsed.opener.length)
      if (end === -1) {
        searchFrom = openIndex + 1
        continue
      }
      out = out.slice(0, openIndex) + out.slice(end)
      changed = true
      break
    }
  }
  return out
}

/** Removes model scratchpad scaffolding from compaction output (see {@link MODEL_SCRATCHPAD_TAG_NAMES}). */
function unwrapWholeSummaryWrapper(text: string): string | null {
  const trimmed = text.trim()
  const opening = /^<summary\b[^>]*>/i.exec(trimmed)
  if (!opening) {
    return null
  }

  const closing = /<\/summary\s*>$/i.exec(trimmed)
  if (!closing || closing.index === undefined) {
    return null
  }

  return trimmed.slice(opening[0].length, closing.index)
}

export function stripModelScratchpadBlocks(raw: string): string {
  const { text: fenceMasked, fences } = maskCodeFences(raw)
  const { text: inlineMasked, spans } = maskInlineCodeSpans(fenceMasked)
  let out = stripKnownModelScratchpadBlocks(inlineMasked)

  const unwrapped = unwrapWholeSummaryWrapper(out)
  if (unwrapped !== null) {
    out = unwrapped
  }

  out = unmaskInlineCodeSpans(out, spans)
  out = unmaskCodeFences(out, fences)
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/** Closing-only pseudo tool-call markup sometimes appended after visible prose in parentless text blocks. */
const TRAILING_TOOL_PROTOCOL_CLOSE_RE =
  /(?:\s*<\/(?:(?:\uFF5C\uFF5C|\|\|)DSML(?:\uFF5C\uFF5C|\|\|)\s*)?(?:parameter|invoke|tool_calls|tool_result)\b[^>]*>\s*)+$/iu

/** Strips a trailing run of tool-protocol closing tags; does not touch tags in fences or inline code. */
export function stripTrailingToolProtocolClosingFragments(raw: string): string {
  if (!raw) return raw
  const { text: fenceMasked, fences } = maskCodeFences(raw)
  const { text: inlineMasked, spans } = maskInlineCodeSpans(fenceMasked)
  let out = inlineMasked
  let previous: string
  do {
    previous = out
    out = out.replace(TRAILING_TOOL_PROTOCOL_CLOSE_RE, '')
  } while (out !== previous)
  out = unmaskInlineCodeSpans(out, spans)
  return unmaskCodeFences(out, fences)
}
