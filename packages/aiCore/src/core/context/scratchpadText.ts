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
const PLACEHOLDER_BASES = ['\uE000', '\uE002', '\uE004', '\uE006']
// The original text may itself contain private-use placeholder tokens (a
// literal U+E000 example in prose). Pick an emission base absent from the
// input so generated tokens stay distinguishable, and never delete an
// unknown-index token on unmask (cherry-pr-review inv_b4be6544122b016d).
function pickPlaceholderBase(text: string, kind: string): string {
  for (const base of PLACEHOLDER_BASES) {
    if (!text.includes(`${base}${kind}_`)) return base
  }
  return PLACEHOLDER_BASES[0]
}

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

function isInsideInlineCodeBefore(text: string, markerStart: number): boolean {
  // Inline code spans survive line breaks but cannot cross a blank line, so
  // scan the containing block: tracking across line breaks keeps an opening
  // backtick visible to later fence markers, and stopping at the block edge
  // keeps a stray backtick in an earlier paragraph from masking them.
  let blockStart = 0
  const blankLine = /\n[ \t]*\n/g
  let blank: RegExpExecArray | null
  while ((blank = blankLine.exec(text)) !== null && blank.index + blank[0].length <= markerStart) {
    blockStart = blank.index + blank[0].length
  }
  const lineSlice = text.slice(blockStart, markerStart)
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
      while (j < lineSlice.length && lineSlice[j] === '`') {
        closeRun++
        j++
      }
      if (closeRun === run) {
        closed = true
        i = j
        break
      }
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

function lineContentEnd(text: string, lineStart: number): number {
  let i = lineStart
  while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
    i++
  }
  return i
}

function isClosingFenceLine(text: string, markerStart: number, fenceChar: string, fenceLen: number): boolean {
  const match = text.slice(markerStart).match(/^([`~])\1{2,}/)
  if (!match || match[1] !== fenceChar || match[0].length < fenceLen) {
    return false
  }
  const afterFence = markerStart + match[0].length
  const lineEnd = lineContentEnd(text, text.lastIndexOf('\n', markerStart - 1) + 1)
  for (let i = afterFence; i < lineEnd; i++) {
    if (text[i] !== ' ' && text[i] !== '\t') {
      return false
    }
  }
  return true
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
    if (!isClosingFenceLine(text, markerStart, fenceChar, fenceLen)) {
      pos = markerStart + 1
      continue
    }
    return lineEndAfter(text, markerStart)
  }
  return -1
}

/**
 * A delimiter preceded by an odd-length backslash run is escaped literal
 * text, not an opener (an even run is an escaped backslash followed by a
 * real delimiter).
 */
function isBackslashEscaped(text: string, index: number): boolean {
  let backslashes = 0
  let i = index - 1
  while (i >= 0 && text[i] === '\\') {
    backslashes++
    i--
  }
  return backslashes % 2 === 1
}

/**
 * Scratchpad block ranges of the text, in first-match order. Inline-code
 * matching must recognize a scratchpad block's boundary before crossing it:
 * a backtick opener INSIDE a block whose only candidate closer sits past the
 * block's end would mask the real boundary and leak internal analysis into
 * replacement context (cherry-pr-review). A complete literal scratchpad
 * element inside a code span outside any block stays maskable: it crosses no
 * enclosing block's boundary. Escaped tags are Markdown-literal, not blocks.
 */
function findScratchpadBlockRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let searchFrom = 0
  while (searchFrom < text.length) {
    const openIndex = text.indexOf('<', searchFrom)
    if (openIndex === -1) break
    if (isBackslashEscaped(text, openIndex)) {
      searchFrom = openIndex + 1
      continue
    }
    const parsed = parseOpeningTagAt(text, openIndex)
    if (!parsed || parsed.isSelfClosing || !isModelScratchpadTagName(parsed.tagName)) {
      searchFrom = openIndex + 1
      continue
    }
    const end = findScratchpadBlockEnd(text, openIndex, parsed.tagName, parsed.opener.length)
    if (end === -1) {
      searchFrom = openIndex + 1
      continue
    }
    ranges.push({ start: openIndex, end })
    searchFrom = end
  }
  return ranges
}

function maskInlineCodeSpans(text: string): {
  text: string
  spans: string[]
  ranges: Array<{ start: number; end: number }>
  placeholderBase: string
} {
  const placeholderBase = pickPlaceholderBase(text, 'INLINE_CODE')
  const spans: string[] = []
  const ranges: Array<{ start: number; end: number }> = []
  const scratchpadRanges = findScratchpadBlockRanges(text)
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

    // An escaped backtick is literal text: treating it as an opener would
    // pair it with a later backtick and mask real content (including
    // scratchpad closers) between them (cherry-pr-review).
    if (isBackslashEscaped(text, pos)) {
      out += text[pos]
      pos++
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
      while (j < text.length && text[j] === '`') {
        closeRun++
        j++
      }
      if (closeRun === run) {
        closedAt = j
        break
      }
    }

    // An opener inside a scratchpad block may only pair within its block: a
    // candidate closer past the block's end would mask the real boundary
    // (cherry-pr-review).
    const enclosing = scratchpadRanges.find((range) => pos > range.start && pos < range.end)

    if (closedAt === -1 || (enclosing !== undefined && closedAt >= enclosing.end)) {
      // No closer matches this run (or only past its scratchpad block's end):
      // emit it whole and advance past it. Advancing one character would
      // reinterpret the run's suffix as a shorter opener and pair it with a
      // later backtick, masking (and then stripping) the content in between
      // (cherry-pr-review).
      out += text.slice(pos, contentStart)
      pos = contentStart
      continue
    }

    const span = text.slice(pos, closedAt)
    spans.push(span)
    ranges.push({ start: pos, end: closedAt })
    out += `${placeholderBase}INLINE_CODE_${spans.length - 1}\uE001`
    pos = closedAt
  }

  return { text: out, spans, ranges, placeholderBase }
}

function unmaskInlineCodeSpans(text: string, spans: string[], placeholderBase = '\uE000'): string {
  return text.replace(
    new RegExp(`${placeholderBase}INLINE_CODE_(\\d+)\\uE001`, 'g'),
    (match, index) => spans[Number(index)] ?? match
  )
}

/**
 * Masks Markdown indented code blocks (runs of lines indented four or more
 * spaces, or a tab) so literal scratchpad-shaped examples inside them survive
 * wrapper removal: fences and inline spans were already protected, but an
 * indented `Example:` block reached global scratchpad removal and lost its
 * content in summary formatting and adapter delivery (cherry-pr-review
 * inv_29a1cf6c61a8326f). Indented code cannot interrupt a paragraph, so a run
 * only starts at the text edge or after a blank line. A run inside a
 * scratchpad block stays unmasked so it cannot hide the block's boundary.
 */
function maskIndentedCodeBlocks(text: string): {
  text: string
  blocks: string[]
  placeholderBase: string
} {
  const placeholderBase = pickPlaceholderBase(text, 'INDENTED_CODE')
  const blocks: string[] = []
  const lines = text.split('\n')
  const lineOffsets: number[] = []
  let offset = 0
  for (const line of lines) {
    lineOffsets.push(offset)
    offset += line.length + 1
  }
  // CommonMark 0.31.2 §4.4: any indentation of four or more columns opens an
  // indented code block - five/eight spaces and repeated tabs are valid too
  // (cherry-pr-review inv_4ab3f6f347edda60).
  const isIndentedCodeLine = (line: string): boolean => /^(?: {4,}|\t+)\S/.test(line)

  const outLines: string[] = []
  let i = 0
  let paragraphOpen = false
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      paragraphOpen = false
      outLines.push(line)
      i++
      continue
    }
    if (paragraphOpen || !isIndentedCodeLine(line)) {
      paragraphOpen = true
      outLines.push(line)
      i++
      continue
    }
    if (enclosingScratchpadTag(text, lineOffsets[i]) !== null) {
      // Indented content of a real scratchpad block must stay visible to
      // boundary detection; masking it could swallow the block's closer.
      paragraphOpen = true
      outLines.push(line)
      i++
      continue
    }
    let end = i
    let lastContent = i
    while (end < lines.length && (lines[end].trim() === '' || isIndentedCodeLine(lines[end]))) {
      if (lines[end].trim() !== '') lastContent = end
      end++
    }
    blocks.push(lines.slice(i, lastContent + 1).join('\n'))
    outLines.push(`${placeholderBase}INDENTED_CODE_${blocks.length - 1}\uE001`)
    paragraphOpen = false
    i = lastContent + 1
  }
  return { text: outLines.join('\n'), blocks, placeholderBase }
}

function unmaskIndentedCodeBlocks(text: string, blocks: string[], placeholderBase = '\uE000'): string {
  return text.replace(
    new RegExp(`${placeholderBase}INDENTED_CODE_(\\d+)\\uE001`, 'g'),
    (match, index) => blocks[Number(index)] ?? match
  )
}

function isCodeFenceMarkerAtLineStart(text: string, markerStart: number): boolean {
  const lineStart = text.lastIndexOf('\n', markerStart - 1) + 1
  const prefix = text.slice(lineStart, markerStart)
  if (isValidFenceLinePrefix(prefix)) {
    return true
  }
  if (isInsideInlineCodeBefore(text, markerStart)) {
    return false
  }
  return /<\/(?:analysis|assessment|thinking)\s*>$/i.test(prefix)
}

/**
 * Tag name of the innermost scratchpad block still open at `pos`, or null when
 * `pos` is outside any scratchpad block. Escaped tags are literal and ignored.
 */
function enclosingScratchpadTag(text: string, pos: number): string | null {
  const tagPattern = /<(\/?)(analysis|assessment|thinking)(?=[\s/>])[^>]*>/gi
  const stack: string[] = []
  // Inline-code tags are literals, not wrappers: an opener such as
  // `Use `<thinking>` blocks:` must not enlist the following fenced example
  // as enclosed scratchpad content (cherry-pr-review inv_fedee4736993b558).
  const { ranges: inlineCodeRanges } = maskInlineCodeSpans(text)
  let rangeIndex = 0
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(text)) !== null) {
    if (match.index >= pos) break
    if (isBackslashEscaped(text, match.index)) continue
    while (rangeIndex < inlineCodeRanges.length && inlineCodeRanges[rangeIndex].end <= match.index) {
      rangeIndex++
    }
    const range = inlineCodeRanges[rangeIndex]
    if (range && match.index >= range.start && match.index < range.end) continue
    const tag = match[2].toLowerCase()
    if (match[1]) {
      const idx = stack.lastIndexOf(tag)
      if (idx !== -1) stack.splice(idx, 1)
    } else {
      stack.push(tag)
    }
  }
  return stack.length ? stack[stack.length - 1] : null
}

function maskCodeFences(text: string): {
  text: string
  fences: string[]
  placeholderBase: string
} {
  const placeholderBase = pickPlaceholderBase(text, 'CODE_FENCE')
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
    // A fence opened inside a scratchpad block ends at that block's closing
    // tag, whether it has no close of its own or only finds one past the
    // boundary: masking through the closer would hide it and keep internal
    // analysis from being stripped (cherry-pr-review inv_85d2261387fd1a1f,
    // inv_e5404aa552bba2ea). A fence outside any scratchpad block still masks
    // to its own close or EOF.
    let blockCloseIdx = -1
    const enclosing = enclosingScratchpadTag(text, fenceStart)
    if (enclosing) {
      const findBlockClose = (from: number): number => {
        const closer = new RegExp(`</${enclosing}\\s*>`, 'gi')
        closer.lastIndex = from
        let match: RegExpExecArray | null
        while ((match = closer.exec(text)) !== null) {
          if (!isBackslashEscaped(text, match.index)) return match.index
        }
        return -1
      }
      // A closer inside a fence that completes is literal fence content, not
      // the block boundary: resolve the boundary at or past the fence's own
      // close (cherry-pr-review inv_bbe597af484323aa). Only when no close
      // exists past a completed fence is an inner closer the real boundary,
      // truncating the dangling fence (inv_e5404aa552bba2ea).
      const pastClose = closeEnd !== -1 ? findBlockClose(closeEnd) : -1
      blockCloseIdx = pastClose !== -1 ? pastClose : findBlockClose(afterOpen)
    }
    if (closeEnd === -1 || (blockCloseIdx !== -1 && closeEnd > blockCloseIdx)) {
      const fenceEnd = blockCloseIdx !== -1 ? blockCloseIdx : text.length
      fences.push(text.slice(fenceStart, fenceEnd))
      out += `${placeholderBase}CODE_FENCE_${fences.length - 1}\uE001`
      pos = fenceEnd
      continue
    }

    const fenceEnd = closeEnd
    fences.push(text.slice(fenceStart, fenceEnd))
    out += `${placeholderBase}CODE_FENCE_${fences.length - 1}\uE001`
    pos = fenceEnd
  }

  return { text: out, fences, placeholderBase }
}

function unmaskCodeFences(text: string, fences: string[], placeholderBase = '\uE000'): string {
  return text.replace(
    new RegExp(`${placeholderBase}CODE_FENCE_(\\d+)\\uE001`, 'g'),
    (match, index) => fences[Number(index)] ?? match
  )
}

/** True when a line ends with 1–2 backtick/tilde characters that may complete a fence on the next delta. */
export function textEndsWithPartialFenceMarker(text: string): boolean {
  return /(?:^|[\r\n])[^\r\n]*[`~]{1,2}$/.test(text)
}

/** True when an inline code span opened by backticks has no closing delimiter yet. */
export function textHasUnclosedInlineCode(text: string): boolean {
  let pos = 0
  while (pos < text.length) {
    if (text[pos] !== '`') {
      const next = text.indexOf('`', pos)
      if (next === -1) return false
      pos = next
      continue
    }

    // An escaped backtick is literal text, never an opener: pairing it with a
    // later backtick releases an unresolved code span over real content,
    // unlike the masking scanner (cherry-pr-review inv_c15500c90c596f07).
    if (isBackslashEscaped(text, pos)) {
      pos++
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
      while (j < text.length && text[j] === '`') {
        closeRun++
        j++
      }
      if (closeRun === run) {
        closedAt = j
        break
      }
    }

    if (closedAt === -1) return true
    pos = closedAt
  }
  return false
}

/** True when scratchpad filtering should wait for more stream input before stripping. */
export function shouldDeferScratchpadStripping(text: string): boolean {
  return textHasUnclosedCodeFence(text) || textEndsWithPartialFenceMarker(text) || textHasUnclosedInlineCode(text)
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
  const { text: fenceMasked, fences, placeholderBase: fenceBase } = maskCodeFences(raw)
  const { text: indentedMasked, blocks, placeholderBase: indentedBase } = maskIndentedCodeBlocks(fenceMasked)
  const { text: inlineMasked, spans, placeholderBase: inlineBase } = maskInlineCodeSpans(indentedMasked)
  const stripped = stripKnownModelScratchpadBlocks(inlineMasked)
  const withInline = unmaskInlineCodeSpans(stripped, spans, inlineBase)
  const withIndented = unmaskIndentedCodeBlocks(withInline, blocks, indentedBase)
  return unmaskCodeFences(withIndented, fences, fenceBase)
}

function findScratchpadBlockEnd(text: string, openIndex: number, tagName: string, openerLength: number): number {
  const afterOpen = openIndex + openerLength
  // Nested same-tag wrappers pair by depth: stopping at the first close would
  // leave the outer block's remaining internal text (and its real closer) in
  // the output (cherry-pr-review inv_66625e6e9e1af1a5). Complete inline-code
  // spans resolve BEFORE wrapper boundaries: a tag inside one is literal code
  // content, except a spanned closing tag that is the block's last closer -
  // an unmatched backtick then keeps the real boundary instead of leaking the
  // block (cherry-pr-review inv_48f6cb86775e99c6 and its twin).
  const tagPattern = new RegExp(`<(/?)${tagName}(?=[\\s/>])[^>]*>`, 'gi')
  tagPattern.lastIndex = afterOpen
  let depth = 1
  let end = -1
  let tagMatch: RegExpExecArray | null
  const codeSpans: Array<{ start: number; end: number }> = []
  let spanCursor = afterOpen
  const collectSpansUntil = (limit: number): void => {
    let pos = spanCursor
    while (pos < limit) {
      const tick = text.indexOf('`', pos)
      if (tick === -1 || tick >= limit) break
      if (isBackslashEscaped(text, tick)) {
        pos = tick + 1
        continue
      }
      let run = 0
      while (tick + run < text.length && text[tick + run] === '`') run++
      let j = tick + run
      let closedAt = -1
      while (j < text.length) {
        if (text[j] !== '`') {
          j++
          continue
        }
        let closeRun = 0
        while (j < text.length && text[j] === '`') {
          closeRun++
          j++
        }
        if (closeRun === run && !isBackslashEscaped(text, j - closeRun)) {
          closedAt = j
          break
        }
      }
      if (closedAt === -1) {
        // Unmatched run: advance past it whole rather than reinterpreting its suffix.
        pos = tick + run
        continue
      }
      codeSpans.push({ start: tick, end: closedAt })
      pos = closedAt
    }
    spanCursor = Math.max(spanCursor, limit)
  }
  while ((tagMatch = tagPattern.exec(text)) !== null) {
    if (isBackslashEscaped(text, tagMatch.index)) continue
    collectSpansUntil(tagMatch.index)
    const tagEnd = tagMatch.index + tagMatch[0].length
    const span = codeSpans.find((s) => tagMatch.index > s.start && tagEnd <= s.end)
    if (span) {
      if (tagMatch[1] !== '/') continue
      const later = new RegExp(`</${tagName}\\s*>`, 'gi')
      later.lastIndex = span.end
      if (later.test(text)) continue
      // Last closer inside a code span: it stays the boundary.
    }
    if (tagMatch[1] === '/') {
      depth--
      if (depth === 0) {
        end = tagEnd
        break
      }
    } else if (!tagMatch[0].endsWith('/>')) {
      depth++
    }
  }
  if (end === -1) return -1
  // Compaction/concatenation can append duplicate closing tags for the same scratchpad wrapper.
  const duplicateClose = new RegExp(`^\\s*</${tagName}\\s*>`, 'i')
  for (;;) {
    const extra = duplicateClose.exec(text.slice(end))
    if (!extra) break
    end += extra[0].length
  }
  return end
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
      // A backslash-escaped tag is Markdown-literal content, not a scratchpad
      // wrapper: recognizing it strips ordinary literal text from assistant
      // prose and compaction summaries (cherry-pr-review).
      if (isBackslashEscaped(out, openIndex)) {
        searchFrom = openIndex + 1
        continue
      }
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
  const { text: fenceMasked, fences, placeholderBase: fenceBase } = maskCodeFences(raw)
  const { text: indentedMasked, blocks, placeholderBase: indentedBase } = maskIndentedCodeBlocks(fenceMasked)
  const { text: inlineMasked, spans, placeholderBase: inlineBase } = maskInlineCodeSpans(indentedMasked)
  let out = stripKnownModelScratchpadBlocks(inlineMasked)

  const unwrapped = unwrapWholeSummaryWrapper(out)
  if (unwrapped !== null) {
    out = unwrapped
  }

  out = unmaskInlineCodeSpans(out, spans, inlineBase)
  out = unmaskIndentedCodeBlocks(out, blocks, indentedBase)
  out = unmaskCodeFences(out, fences, fenceBase)
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/** Closing-only pseudo tool-call markup sometimes appended after visible prose in parentless text blocks. */
const TRAILING_TOOL_PROTOCOL_CLOSE_RE =
  /(?:\s*<\/(?:(?:\uFF5C\uFF5C|\|\|)DSML(?:\uFF5C\uFF5C|\|\|)\s*)?(?:parameter|invoke|tool_calls|tool_result)\b[^>]*>\s*)+$/iu

/** Strips a trailing run of tool-protocol closing tags; does not touch tags in fences or inline code. */
export function stripTrailingToolProtocolClosingFragments(raw: string): string {
  if (!raw) return raw
  const { text: fenceMasked, fences, placeholderBase: fenceBase } = maskCodeFences(raw)
  const { text: indentedMasked, blocks, placeholderBase: indentedBase } = maskIndentedCodeBlocks(fenceMasked)
  const { text: inlineMasked, spans, placeholderBase: inlineBase } = maskInlineCodeSpans(indentedMasked)
  let out = inlineMasked
  let previous: string
  do {
    previous = out
    out = out.replace(TRAILING_TOOL_PROTOCOL_CLOSE_RE, '')
  } while (out !== previous)
  out = unmaskInlineCodeSpans(out, spans, inlineBase)
  out = unmaskIndentedCodeBlocks(out, blocks, indentedBase)
  return unmaskCodeFences(out, fences, fenceBase)
}
