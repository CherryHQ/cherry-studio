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
        // Unquoted values end at whitespace or '>' only: a slash inside the
        // value is ordinary content (HTML5 unquoted-attribute-value), so
        // stopping at '/' here rejects tags such as <analysis path=foo/bar>
        // and leaks the private block past stripping (cherry-pr-review
        // inv_2bc29d4d0ef02dc5#f1). A self-closing terminator is still
        // recognized after the value, when '/' directly precedes '>'.
        while (i < text.length && text[i] !== ' ' && text[i] !== '\t' && text[i] !== '>') {
          i++
        }
      }
    }
  }
  return null
}

/** Comments and CDATA contain literal markup, never scratchpad boundaries. */
function opaqueMarkupEnd(text: string, start: number): number | null {
  const terminator = text.startsWith('<!--', start) ? '-->' : text.startsWith('<![CDATA[', start) ? ']]>' : null
  if (!terminator) return null
  const close = text.indexOf(terminator, start + (terminator === '-->' ? 4 : 9))
  return close < 0 ? text.length : close + terminator.length
}

/** HTML opening-tag attributes are opaque to Markdown code-span openers. */
function htmlOpeningTagLookup(text: string): (index: number) => boolean {
  const ranges: Array<{ start: number; end: number }> = []
  let pos = 0
  while (pos < text.length) {
    const start = text.indexOf('<', pos)
    if (start < 0) break
    const opaqueEnd = opaqueMarkupEnd(text, start)
    if (opaqueEnd !== null) {
      ranges.push({ start, end: opaqueEnd })
      pos = opaqueEnd
      continue
    }
    const tag = isBackslashEscaped(text, start) ? null : parseOpeningTagAt(text, start)
    if (tag) {
      pos = start + tag.opener.length
      ranges.push({ start, end: pos })
    } else pos = start + 1
  }
  return (index) => {
    let low = 0
    let high = ranges.length - 1
    while (low <= high) {
      const mid = (low + high) >>> 1
      const range = ranges[mid]
      if (index < range.start) high = mid - 1
      else if (index >= range.end) low = mid + 1
      else return true
    }
    return false
  }
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

/** Expand indentation tabs at CommonMark's four-column tab stops. */
function expandFencePrefixTabs(prefix: string): string {
  let expanded = ''
  for (const char of prefix) expanded += char === '\t' ? ' '.repeat(4 - (expanded.length % 4)) : char
  return expanded
}

function isValidFenceLinePrefix(prefix: string): boolean {
  prefix = expandFencePrefixTabs(prefix)
  let i = 0
  while (i < prefix.length) {
    if (prefix[i] === '>') {
      i++
      // Container whitespace: after the blockquote marker Markdown expands a
      // tab to the next 4-column stop, so '>\t' separates marker and content
      // exactly like '> ' (cherry-pr-review inv_8d793e19d8fb1409#f1).
      if (i < prefix.length && (prefix[i] === ' ' || prefix[i] === '\t')) i++
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
      // Do not restart the three-space allowance inside one container.
      if (spaces === 0 || prefix[i] === ' ') return false
      continue
    }
    return false
  }
  return true
}

function fenceLinePrefixStart(text: string, fenceMarkerIndex: number): number {
  const lineStart = lineStartBefore(text, fenceMarkerIndex)
  const prefix = text.slice(lineStart, fenceMarkerIndex)
  if (prefix.length > 0 && isValidFenceLinePrefix(prefix)) {
    return lineStart
  }
  return fenceMarkerIndex
}

function isInsideInlineCodeBefore(text: string, markerStart: number): boolean {
  // Inline code spans survive line breaks but cannot cross leaf blocks, so
  // scan the containing block: tracking across line breaks keeps an opening
  // backtick visible to later fence markers, and stopping at the block edge
  // keeps a stray backtick in an earlier paragraph from masking them.
  const blockStart = inlineBlockStart(text, markerStart)
  const lineSlice = text.slice(blockStart, markerStart)
  const inHtml = htmlOpeningTagLookup(lineSlice)
  let i = 0
  while (i < lineSlice.length) {
    if (lineSlice[i] !== '`' || inHtml(i)) {
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

/** Markdown leaf blocks interrupt paragraphs even without a separating blank line. */
function isInlineBlockBoundary(line: string): boolean {
  const content = stripMarkdownContainerMarkers(line)
  return (
    content.trim() === '' ||
    /^[\uE000-\uF8FF]CODE_FENCE_\d+\uE001/.test(content.trim()) ||
    /^ {0,3}(?:<!--|<![A-Z]|<\?|<!\[CDATA\[|<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|pre|script|search|section|source|style|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t>]|$))/i.test(
      content
    ) ||
    /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(content) ||
    /^ {0,3}(?:=+|-+)[ \t]*$/.test(content) ||
    /^ {0,3}(?:\*[ \t]*){3,}$/.test(content) ||
    /^ {0,3}(?:_[ \t]*){3,}$/.test(content)
  )
}

function lineStartBefore(text: string, index: number): number {
  // Search both newline spellings together. Separate lastIndexOf calls scan
  // the full prefix for an absent CR on ordinary LF documents, per fence.
  for (let i = index - 1; i >= 0; i--) {
    if (text[i] === '\n' || text[i] === '\r') return i + 1
  }
  return 0
}

function isListItemStart(line: string): boolean {
  return /^(?: {0,3}> ?)* {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/.test(line)
}

function explicitQuoteDepth(line: string): number {
  let rest = line
  let depth = 0
  for (;;) {
    const marker = /^ {0,3}> ?/.exec(rest)
    if (!marker) return depth
    depth++
    rest = rest.slice(marker[0].length)
  }
}

function inlineBlockStart(text: string, index: number): number {
  let start = 0
  let quoteDepth = 0
  for (let pos = 0; pos <= index;) {
    const end = lineEndAfter(text, pos)
    const line = text.slice(pos, lineContentEnd(text, pos))
    const depth = explicitQuoteDepth(line)
    if (depth > 0 && depth !== quoteDepth) start = pos
    if (end > index) break
    if (isInlineBlockBoundary(line)) {
      start = end
      quoteDepth = 0
    } else {
      if (isListItemStart(line)) start = pos
      if (depth > 0) quoteDepth = depth
    }
    if (end <= pos) break
    pos = end
  }
  return start
}

function inlineBlockEnd(text: string, from: number): number {
  const currentStart = lineStartBefore(text, from)
  const currentEnd = lineEndAfter(text, from)
  // A heading is its own leaf, including when its code span is unfinished.
  if (isInlineBlockBoundary(text.slice(currentStart, lineContentEnd(text, currentStart)))) return currentEnd
  let quoteDepth = explicitQuoteDepth(text.slice(currentStart, lineContentEnd(text, currentStart)))
  for (let start = currentEnd; start < text.length; start = lineEndAfter(text, start)) {
    const line = text.slice(start, lineContentEnd(text, start))
    const depth = explicitQuoteDepth(line)
    if (isInlineBlockBoundary(line) || isListItemStart(line) || (depth > 0 && depth !== quoteDepth)) return start
    if (depth > 0) quoteDepth = depth
  }
  return text.length
}

/**
 * True when `index` sits inside a complete inline-code span. Spans cannot
 * cross leaf-block boundaries, so start at the containing block's edge.
 */
function isInsideCompleteInlineCodeSpan(text: string, index: number): boolean {
  let cachedBlockEnd = -1
  const inHtml = htmlOpeningTagLookup(text)
  const blockStart = inlineBlockStart(text, index)
  let pos = blockStart
  while (pos < index) {
    const tick = text.indexOf('`', pos)
    if (tick === -1 || tick >= index) return false
    if (isBackslashEscaped(text, tick) || inHtml(tick)) {
      pos = tick + 1
      continue
    }
    let run = 0
    while (tick + run < text.length && text[tick + run] === '`') run++
    if (run >= 3) {
      // A 3+ run is fence material, not an inline-code opener: pairing it
      // with a later fence marker would declare real block boundaries
      // "inside a span" and hide them (cherry-pr-review inv_4b313ccdbd33f14b
      // vs inv_e5404aa552bba2ea). The pipeline masks fences before inline
      // spans, so an inline span never contains a fence here either.
      pos = tick + run
      continue
    }
    let j = tick + run
    let closedAt = -1
    const blockEnd = j < cachedBlockEnd ? cachedBlockEnd : (cachedBlockEnd = inlineBlockEnd(text, j))
    while (j < blockEnd) {
      if (text[j] !== '`') {
        j++
        continue
      }
      let closeRun = 0
      while (j < text.length && text[j] === '`') {
        closeRun++
        j++
      }
      // Inside a code span a backslash is literal text, so it cannot escape
      // the closing backtick: rejecting this delimiter leaves the span open
      // and lets a literal tag inside it become the wrapper boundary
      // (CommonMark 0.31.2; cherry-pr-review inv_ccf2d4de8815a708).
      if (closeRun === run) {
        closedAt = j
        break
      }
    }
    if (closedAt === -1) return false
    if (index > tick && index < closedAt) return true
    pos = closedAt
  }
  return false
}

function lineEndAfter(text: string, from: number): number {
  const end = lineContentEnd(text, from)
  if (end === text.length) return end
  return end + (text[end] === '\r' && text[end + 1] === '\n' ? 2 : 1)
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
  const lineEnd = lineContentEnd(text, lineStartBefore(text, markerStart))
  for (let i = afterFence; i < lineEnd; i++) {
    if (text[i] !== ' ' && text[i] !== '\t') {
      return false
    }
  }
  return true
}

/** One container segment parsed from a fence opener's line prefix. */
type FenceContainerSegment = { type: 'quote' } | { type: 'list'; contentCol: number }

function parseFenceContainerSegments(prefix: string): FenceContainerSegment[] {
  prefix = expandFencePrefixTabs(prefix)
  const segments: FenceContainerSegment[] = []
  let rest = prefix
  for (;;) {
    const quote = /^ {0,3}>[ \t]?/.exec(rest)
    if (quote) {
      segments.push({ type: 'quote' })
      rest = rest.slice(quote[0].length)
      continue
    }
    const list = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)/.exec(rest)
    if (list) {
      // List item content begins after the marker and its following spaces
      // (CommonMark 0.31.2 §5.2: one space when the run exceeds four).
      const padding = list[3] === '' ? 1 : Math.min(list[3].length, 4)
      segments.push({ type: 'list', contentCol: list[1].length + list[2].length + padding })
      rest = rest.slice(list[0].length)
      continue
    }
    // Up to three columns of indentation may precede the fence marker itself.
    break
  }
  return segments
}

/**
 * Whether a candidate closing-fence line sits in the same container context
 * as the opener: the opener's blockquote markers must repeat on the closing
 * line, and its list items must continue - either by a repeated marker with
 * the same content column or by indentation reaching it. Nothing but up to
 * three columns of closing indentation may follow: a fence opened at the top
 * level is not closed by a marker prefixed with `> ` or a list marker, and
 * vice versa - such a prefixed marker is literal content of the outer block
 * (cherry-pr-review inv_896e68088dfc29d1).
 */
function fenceCloseMatchesContainerContext(candidatePrefix: string, openerPrefix: string): boolean {
  const segments = parseFenceContainerSegments(openerPrefix)
  let rest = expandFencePrefixTabs(candidatePrefix)
  for (const segment of segments) {
    if (segment.type === 'quote') {
      const quote = /^ {0,3}>[ \t]?/.exec(rest)
      if (!quote) return false
      rest = rest.slice(quote[0].length)
      continue
    }
    // A repeated list marker begins a SIBLING item, and the opener's item ends
    // there: a fence opened inside one item is closed implicitly at the item
    // boundary, so the sibling item's fence marker is a new block's opener,
    // never this block's closer. Accepting it exposes the remaining content of
    // the actual fenced block to scratchpad removal (cherry-pr-review
    // inv_ef115bae05b2a143).
    if (/^( {0,3})([-*+]|\d{1,9}[.)])( +|$)/.test(rest)) return false
    // A continuation line reaches the item's content column by indentation.
    let spaces = 0
    while (spaces < rest.length && rest[spaces] === ' ') spaces++
    if (spaces < segment.contentCol) return false
    rest = rest.slice(segment.contentCol)
  }
  return /^ {0,3}$/.test(rest)
}

function fenceContainerEnd(text: string, openerLineEnd: number, openerPrefix: string): number {
  const segments = parseFenceContainerSegments(openerPrefix)
  if (segments.length === 0) return text.length
  for (let start = openerLineEnd; start < text.length; start = lineEndAfter(text, start)) {
    let rest = expandFencePrefixTabs(text.slice(start, lineContentEnd(text, start)))
    for (const segment of segments) {
      if (segment.type === 'quote') {
        const quote = /^ {0,3}> ?/.exec(rest)
        if (!quote) return start
        rest = rest.slice(quote[0].length)
      } else {
        // Blank lines may remain inside a list, but sibling/dedented content
        // ends its fenced block even without a closing marker.
        if (rest.trim() === '') break
        const spaces = rest.match(/^ */)?.[0].length ?? 0
        if (spaces < segment.contentCol) return start
        rest = rest.slice(segment.contentCol)
      }
    }
  }
  return text.length
}

/** Precompute list-container extents once instead of scanning every prefix per fence. */
function inheritedFencePrefixLookup(text: string): (openerStart: number, prefix: string) => string {
  const lists: Array<{ start: number; end: number; prefix: string }> = []
  for (let start = 0; start < text.length; start = lineEndAfter(text, start)) {
    const line = expandFencePrefixTabs(text.slice(start, lineContentEnd(text, start)))
    const prefix = /^(?:(?: {0,3}> ?)|(?: {0,3}(?:[-*+]|\d{1,9}[.)]) +))+/.exec(line)?.[0]
    if (prefix && parseFenceContainerSegments(prefix).some((segment) => segment.type === 'list'))
      lists.push({ start, end: fenceContainerEnd(text, lineEndAfter(text, start), prefix), prefix })
  }
  return (openerStart, openerPrefix) => {
    if (openerPrefix === '' || parseFenceContainerSegments(openerPrefix).some((segment) => segment.type === 'list'))
      return openerPrefix
    let inherited = openerPrefix
    for (const list of lists) {
      if (list.start >= openerStart) break
      if (list.end > openerStart && fenceCloseMatchesContainerContext(openerPrefix, list.prefix))
        inherited = list.prefix
    }
    return inherited
  }
}

function findCodeFenceClose(
  text: string,
  searchFrom: number,
  fenceChar: string,
  fenceLen: number,
  openerPrefix = '',
  inheritedPrefix = inheritedFencePrefixLookup(text)
): number {
  openerPrefix = inheritedPrefix(lineStartBefore(text, searchFrom), openerPrefix)
  const containerEnd = fenceContainerEnd(text, lineEndAfter(text, searchFrom), openerPrefix)
  let pos = searchFrom
  while (pos < text.length) {
    const rel = text.slice(pos).search(/[`~]{3,}/)
    if (rel === -1 || pos + rel >= containerEnd) return containerEnd < text.length ? containerEnd : -1
    const markerStart = pos + rel
    if (!isCodeFenceMarkerAtLineStart(text, markerStart)) {
      pos = markerStart + 1
      continue
    }
    const candidateLineStart = lineStartBefore(text, markerStart)
    if (!fenceCloseMatchesContainerContext(text.slice(candidateLineStart, markerStart), openerPrefix)) {
      pos = markerStart + 1
      continue
    }
    if (!isClosingFenceLine(text, markerStart, fenceChar, fenceLen)) {
      pos = markerStart + 1
      continue
    }
    return lineEndAfter(text, markerStart)
  }
  return containerEnd < text.length ? containerEnd : -1
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
    const opaqueEnd = opaqueMarkupEnd(text, openIndex)
    if (opaqueEnd !== null) {
      searchFrom = opaqueEnd
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
  let cachedBlockEnd = -1
  const inHtml = htmlOpeningTagLookup(text)
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
    if (isBackslashEscaped(text, pos) || inHtml(pos)) {
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
    const blockEnd = j < cachedBlockEnd ? cachedBlockEnd : (cachedBlockEnd = inlineBlockEnd(text, j))
    while (j < blockEnd) {
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
    let low = 0
    let high = scratchpadRanges.length - 1
    let enclosing: { start: number; end: number } | undefined
    while (low <= high) {
      const mid = (low + high) >>> 1
      const range = scratchpadRanges[mid]
      if (pos <= range.start) high = mid - 1
      else if (pos >= range.end) low = mid + 1
      else {
        enclosing = range
        break
      }
    }

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
/**
 * Leading Markdown container markers (a blockquote `> ` or a list marker such
 * as `- ` or `1. `) wrap every line of their content: the four columns that
 * open an indented code block sit AFTER the markers, not at column zero
 * (cherry-pr-review inv_5cfd1b3f92913a5c).
 */
function stripMarkdownContainerMarkers(line: string): string {
  let rest = expandFencePrefixTabs(line)
  for (;;) {
    const quote = /^ {0,3}>[ ]?/.exec(rest)
    if (quote) {
      rest = rest.slice(quote[0].length)
      continue
    }
    const list = /^( {0,3})([-*+]|\d{1,9}[.)])( +)/.exec(rest)
    if (!list) return rest
    // CommonMark list content uses one to four padding columns. Five or
    // more means one separator followed by indented code, not wider padding.
    const padding = list[3].length <= 4 ? list[3].length : 1
    rest = rest.slice(list[1].length + list[2].length + padding)
  }
}

/** A line of only blockquote markers is its container's blank line: it closes an open paragraph. */
function isContainerOnlyLine(line: string): boolean {
  return line.includes('>') && stripMarkdownContainerMarkers(line).trim() === ''
}

function maskIndentedCodeBlocks(text: string): {
  text: string
  blocks: string[]
  placeholderBase: string
} {
  const placeholderBase = pickPlaceholderBase(text, 'INDENTED_CODE')
  const blocks: string[] = []
  const lines = text.split(/\r\n|\r|\n/)
  const endings = text.match(/\r\n|\r|\n/g) ?? []
  const lineOffsets: number[] = []
  let offset = 0
  for (const line of lines) {
    lineOffsets.push(offset)
    offset += line.length + (endings[lineOffsets.length - 1]?.length ?? 0)
  }
  // CommonMark 0.31.2 §4.4: any indentation of four or more columns opens an
  // indented code block - five/eight spaces and repeated tabs are valid too
  // (cherry-pr-review inv_4ab3f6f347edda60).
  // CommonMark 0.31.2 §4.4 + §2.2: indentation is measured in columns with
  // tab stops - a tab advances to the next multiple of four, so three spaces
  // and a tab (column four) opens an indented code block just like four
  // spaces, five/eight spaces, or repeated tabs (cherry-pr-review
  // inv_4ab3f6f347edda60, inv_c51149ed55871417).
  let inheritedListColumns = 0
  const indentedCodeColumns = (line: string): number => {
    const content = stripMarkdownContainerMarkers(line)
    let columns = 0
    for (let k = 0; k < content.length; k++) {
      if (content[k] === ' ') columns += 1
      else if (content[k] === '\t') columns += 4 - (columns % 4)
      else break
    }
    // Explicit markers were stripped above; continuation lines still carry
    // the inherited list's content indentation.
    return content !== line ? columns : Math.max(0, columns - inheritedListColumns)
  }
  const isIndentedCodeLine = (line: string): boolean => line.trim() !== '' && indentedCodeColumns(line) >= 4

  // CommonMark leaf blocks close a paragraph, so indentation after them
  // opens indented code rather than continuing paragraph text: an ATX
  // heading, a setext underline, a thematic break, or a masked fence block
  // (CommonMark 0.31.2 §4.4; cherry-pr-review inv_0847c277aaa83851). A setext
  // underline only closes an OPEN paragraph; on its own it is paragraph text.
  const isLeafBlockBoundaryLine = (line: string, paragraphWasOpen: boolean): boolean => {
    const content = stripMarkdownContainerMarkers(line)
    if (/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(content)) return true
    if (/^ {0,3}(?:\*[ \t]*){3,}$/.test(content)) return true
    if (/^ {0,3}(?:_[ \t]*){3,}$/.test(content)) return true
    if (/^ {0,3}(?:-[ \t]*){3,}$/.test(content)) return true
    if (/^[\uE000-\uF8FF]CODE_FENCE_\d+\uE001[ \t]*$/.test(content.trim())) return true
    if (paragraphWasOpen && /^ {0,3}(?:=+|-+)[ \t]*$/.test(content)) return true
    return false
  }

  const inlineRanges = maskInlineCodeSpans(text).ranges
  const scratchpadScan = { pos: 0, stack: [] as string[] }
  const outLines: string[] = []
  let i = 0
  let paragraphOpen = false
  let quoteDepth = 0
  while (i < lines.length) {
    const line = lines[i]
    const depth = explicitQuoteDepth(line)
    const previousListColumns = inheritedListColumns
    const expanded = expandFencePrefixTabs(line)
    // Nested items begin at their parent's content column, which can exceed
    // the three optional columns allowed relative to the current container.
    const nestedOffset =
      inheritedListColumns > 0 && expanded.startsWith(' '.repeat(inheritedListColumns)) ? inheritedListColumns : 0
    const list = /^( {0,3})([-*+]|\d{1,9}[.)])( +)(.*)$/.exec(expanded.slice(nestedOffset))
    if (list) {
      const padding = list[3].length <= 4 ? list[3].length : 1
      inheritedListColumns = nestedOffset + list[1].length + list[2].length + padding
    } else if (line.trim() !== '' && !line.startsWith(' '.repeat(inheritedListColumns))) inheritedListColumns = 0
    // A new explicit quote container cannot inherit an outer paragraph.
    // Unmarked lazy continuation lines keep their paragraph's container.
    if ((depth > 0 && depth !== quoteDepth) || isListItemStart(line) || previousListColumns !== inheritedListColumns)
      paragraphOpen = false
    if (depth > 0) quoteDepth = depth
    if (line.trim() === '' || isContainerOnlyLine(line)) {
      paragraphOpen = false
      outLines.push(line + (endings[i] ?? ''))
      i++
      continue
    }
    if (paragraphOpen || !isIndentedCodeLine(line)) {
      paragraphOpen = !isLeafBlockBoundaryLine(line, paragraphOpen)
      outLines.push(line + (endings[i] ?? ''))
      i++
      continue
    }
    if (enclosingScratchpadTag(text, lineOffsets[i], inlineRanges, scratchpadScan) !== null) {
      // Indented content of a real scratchpad block must stay visible to
      // boundary detection; masking it could swallow the block's closer.
      paragraphOpen = true
      outLines.push(line + (endings[i] ?? ''))
      i++
      continue
    }
    let end = i
    let lastContent = i
    while (end < lines.length && (lines[end].trim() === '' || isIndentedCodeLine(lines[end]))) {
      if (lines[end].trim() !== '') lastContent = end
      end++
    }
    blocks.push(
      lines
        .slice(i, lastContent + 1)
        .map((line, j) => line + (j + i < lastContent ? endings[j + i] : ''))
        .join('')
    )
    outLines.push(`${placeholderBase}INDENTED_CODE_${blocks.length - 1}\uE001${endings[lastContent] ?? ''}`)
    paragraphOpen = false
    i = lastContent + 1
  }
  return { text: outLines.join(''), blocks, placeholderBase }
}

function unmaskIndentedCodeBlocks(text: string, blocks: string[], placeholderBase = '\uE000'): string {
  return text.replace(
    new RegExp(`${placeholderBase}INDENTED_CODE_(\\d+)\\uE001`, 'g'),
    (match, index) => blocks[Number(index)] ?? match
  )
}

function hasValidFenceInfo(text: string, markerStart: number, markerLength: number): boolean {
  return (
    text[markerStart] !== '`' ||
    !text.slice(markerStart + markerLength, lineContentEnd(text, lineStartBefore(text, markerStart))).includes('`')
  )
}

function isCodeFenceMarkerAtLineStart(text: string, markerStart: number): boolean {
  const lineStart = lineStartBefore(text, markerStart)
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
function enclosingScratchpadTag(
  text: string,
  pos: number,
  cachedInlineRanges?: Array<{ start: number; end: number }>,
  scanState?: { pos: number; stack: string[] }
): string | null {
  const stack: string[] = scanState?.stack ?? []
  // Inline-code tags are literals, not wrappers: an opener such as
  // `Use `<thinking>` blocks:` must not enlist the following fenced example
  // as enclosed scratchpad content (cherry-pr-review inv_fedee4736993b558).
  const inlineCodeRanges = cachedInlineRanges ?? maskInlineCodeSpans(text).ranges
  let rangeIndex = 0
  if (scanState) {
    let low = 0
    let high = inlineCodeRanges.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (inlineCodeRanges[mid].end <= scanState.pos) low = mid + 1
      else high = mid
    }
    rangeIndex = low
  }
  const inInlineCode = (index: number): boolean => {
    while (rangeIndex < inlineCodeRanges.length && inlineCodeRanges[rangeIndex].end <= index) {
      rangeIndex++
    }
    const range = inlineCodeRanges[rangeIndex]
    return range !== undefined && index >= range.start && index < range.end
  }
  // Scan whole tags with the deterministic opener parser instead of a bare
  // tag-name regex: quoted attribute contents (a `<thinking>` inside
  // title="...") are attribute text, not wrappers, and counting them leaves
  // the real boundary hidden through EOF so the private analysis survives
  // stripping (cherry-pr-review inv_40ce8f82f82c9aee#f1).
  let i = scanState?.pos ?? 0
  while (i < pos) {
    const lt = text.indexOf('<', i)
    if (lt === -1 || lt >= pos) break
    if (isBackslashEscaped(text, lt)) {
      i = lt + 1
      continue
    }
    const opaqueEnd = opaqueMarkupEnd(text, lt)
    if (opaqueEnd !== null) {
      i = opaqueEnd
      continue
    }
    const closeMatch = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(text.slice(lt, pos + 1))
    if (closeMatch) {
      i = lt + closeMatch[0].length
      const tag = closeMatch[1].toLowerCase()
      if (!MODEL_SCRATCHPAD_TAG_SET.has(tag) || inInlineCode(lt)) continue
      const idx = stack.lastIndexOf(tag)
      if (idx !== -1) stack.splice(idx, 1)
      continue
    }
    const parsed = parseOpeningTagAt(text, lt)
    if (!parsed) {
      i = lt + 1
      continue
    }
    i = lt + parsed.opener.length
    const tag = parsed.tagName.toLowerCase()
    if (!MODEL_SCRATCHPAD_TAG_SET.has(tag) || inInlineCode(lt)) continue
    // Self-closing tags enclose nothing: pushing `<thinking/>` leaves the
    // stack awaiting a `</thinking>` that never comes, so a fence inside
    // the enclosing block masks the real `</analysis>` through EOF and the
    // private analysis survives stripping (cherry-pr-review
    // inv_ad4c45e6af29f23f#f1). Parse openers consistently with the rest
    // of the formatter.
    if (parsed.isSelfClosing) continue
    stack.push(tag)
  }
  if (scanState) scanState.pos = Math.max(pos, i)
  return stack.length ? stack[stack.length - 1] : null
}

function maskCodeFences(text: string): {
  text: string
  fences: string[]
  placeholderBase: string
} {
  const placeholderBase = pickPlaceholderBase(text, 'CODE_FENCE')
  const fences: string[] = []
  const inlineRanges = maskInlineCodeSpans(text).ranges
  const scratchpadScan = { pos: 0, stack: [] as string[] }
  let out = ''
  const inheritedPrefix = inheritedFencePrefixLookup(text)
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

    if (!hasValidFenceInfo(text, markerStart, openMatch[0].length)) {
      const end = lineEndAfter(text, markerStart)
      out += text.slice(fenceStart, end)
      pos = end
      continue
    }
    const fenceChar = openMatch[1]
    const fenceLen = openMatch[0].length
    const afterOpen = markerStart + openMatch[0].length
    const closeEnd = findCodeFenceClose(
      text,
      afterOpen,
      fenceChar,
      fenceLen,
      text.slice(fenceStart, markerStart),
      inheritedPrefix
    )
    // A fence opened inside a scratchpad block ends at that block's closing
    // tag, whether it has no close of its own or only finds one past the
    // boundary: masking through the closer would hide it and keep internal
    // analysis from being stripped (cherry-pr-review inv_85d2261387fd1a1f,
    // inv_e5404aa552bba2ea). A fence outside any scratchpad block still masks
    // to its own close or EOF.
    let blockCloseIdx = -1
    const enclosing = enclosingScratchpadTag(text, fenceStart, inlineRanges, scratchpadScan)
    if (enclosing) {
      const findBlockClose = (from: number): number => {
        const closer = new RegExp(`</${enclosing}\\s*>`, 'gi')
        closer.lastIndex = from
        let match: RegExpExecArray | null
        while ((match = closer.exec(text)) !== null) {
          if (isBackslashEscaped(text, match.index)) continue
          // A closer mentioned inside a complete inline-code span is literal
          // code content (e.g. Example `</analysis>` in the following
          // summary), never the block boundary (cherry-pr-review
          // inv_4b313ccdbd33f14b).
          if (isInsideCompleteInlineCodeSpan(text, match.index)) continue
          return match.index
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

    // Keep the closing line's newline in the masked document: the following
    // indented code must remain on its own line (inv_732c4e7e9bebf1a7).
    const separator = /(?:\r\n|\r|\n)$/.exec(text.slice(Math.max(0, closeEnd - 2), closeEnd))?.[0] ?? ''
    const fenceEnd = closeEnd - separator.length
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
  let cachedBlockEnd = -1
  const inHtml = htmlOpeningTagLookup(text)
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
    if (isBackslashEscaped(text, pos) || inHtml(pos)) {
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
    const blockEnd = j < cachedBlockEnd ? cachedBlockEnd : (cachedBlockEnd = inlineBlockEnd(text, j))
    while (j < blockEnd) {
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

/** Keep the outer tag's quote context before interpreting attribute text.
 * A later '<' or '>' inside an unfinished quoted value is not a new tag. */
function textHasIncompleteMarkup(text: string): boolean {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '<' || isBackslashEscaped(text, start) || !/^<(?:[a-z/!?]|$)/i.test(text.slice(start))) continue
    let quote = ''
    let end = start + 1
    for (; end < text.length; end++) {
      const char = text[end]
      if (quote) {
        if (char === quote) quote = ''
      } else if (char === '"' || char === "'") quote = char
      else if (char === '>') break
    }
    if (end === text.length) return true
    start = end
  }
  return false
}

function textHasUnclosedScratchpad(text: string): boolean {
  if (!/<(?:analysis|assessment|thinking)\b/i.test(text)) return false
  const fenced = maskCodeFences(text).text
  const indented = maskIndentedCodeBlocks(fenced).text
  return enclosingScratchpadTag(indented, indented.length) !== null
}

/** True when scratchpad filtering should wait for more stream input before stripping. */
export function shouldDeferScratchpadStripping(text: string): boolean {
  return (
    textHasIncompleteMarkup(text) ||
    textHasUnclosedScratchpad(text) ||
    textHasUnclosedCodeFence(text) ||
    textEndsWithPartialFenceMarker(text) ||
    textHasUnclosedInlineCode(/[`~]{3}/.test(text) ? maskCodeFences(text).text : text)
  )
}

/** True when the text opens a fenced code block that has no closing delimiter yet. */
export function textHasUnclosedCodeFence(text: string): boolean {
  const inheritedPrefix = inheritedFencePrefixLookup(text)
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

    if (!hasValidFenceInfo(text, markerStart, openMatch[0].length)) {
      pos = lineEndAfter(text, markerStart)
      continue
    }
    const fenceChar = openMatch[1]
    const fenceLen = openMatch[0].length
    const afterOpen = markerStart + openMatch[0].length
    const openerLineStart = fenceLinePrefixStart(text, markerStart)
    const closeEnd = findCodeFenceClose(
      text,
      afterOpen,
      fenceChar,
      fenceLen,
      text.slice(openerLineStart, markerStart),
      inheritedPrefix
    )
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
  const lowerTagName = tagName.toLowerCase()
  let depth = 1
  let end = -1
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
        // Inside a code span a backslash is literal text, so it cannot
        // escape the closing backtick (cherry-pr-review inv_ccf2d4de8815a708).
        if (closeRun === run) {
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
  // Scan whole tags one at a time: a quoted attribute value can itself hold
  // `<tagName>`-shaped text (e.g. `<div title="</analysis>">`), and only the
  // enclosing tag's full extent proves that text is attribute content rather
  // than the block boundary (cherry-pr-review inv_2da074292d7f1ad1). Other
  // tags are skipped whole; the block's own tag falls back to the lenient
  // legacy pattern when strict parsing fails, preserving the prior tolerance
  // for malformed markup.
  let scanPos = afterOpen
  while (scanPos < text.length) {
    const lt = text.indexOf('<', scanPos)
    if (lt === -1) break
    if (isBackslashEscaped(text, lt)) {
      scanPos = lt + 1
      continue
    }
    const opaqueEnd = opaqueMarkupEnd(text, lt)
    if (opaqueEnd !== null) {
      scanPos = opaqueEnd
      continue
    }
    let tagEnd = -1
    let isClosing = false
    let isSelfClosing = false
    let isTargetTag = false
    if (text.startsWith('</', lt)) {
      const closeMatch = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(text.slice(lt))
      if (closeMatch) {
        tagEnd = lt + closeMatch[0].length
        isClosing = true
        isTargetTag = closeMatch[1].toLowerCase() === lowerTagName
      }
    } else {
      const parsed = parseOpeningTagAt(text, lt)
      if (parsed) {
        tagEnd = lt + parsed.opener.length
        isSelfClosing = parsed.isSelfClosing
        isTargetTag = parsed.tagName.toLowerCase() === lowerTagName
      }
    }
    if (tagEnd === -1) {
      const legacy = new RegExp(`^<(/?)${tagName}(?=[\\s/>])[^>]*>`, 'i').exec(text.slice(lt))
      if (legacy) {
        tagEnd = lt + legacy[0].length
        isClosing = legacy[1] === '/'
        isSelfClosing = legacy[0].endsWith('/>')
        isTargetTag = true
      }
    }
    if (tagEnd === -1) {
      scanPos = lt + 1
      continue
    }
    scanPos = tagEnd
    if (!isTargetTag) continue
    collectSpansUntil(lt)
    const span = codeSpans.find((sp) => lt > sp.start && tagEnd <= sp.end)
    if (span) {
      if (!isClosing) continue
      const later = new RegExp(`</${tagName}\\s*>`, 'gi')
      later.lastIndex = span.end
      if (later.test(text)) continue
      // Last closer inside a code span: it stays the boundary.
    }
    if (isClosing) {
      depth--
      if (depth === 0) {
        end = tagEnd
        break
      }
    } else if (!isSelfClosing) {
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
      const opaqueEnd = opaqueMarkupEnd(out, openIndex)
      if (opaqueEnd !== null) {
        searchFrom = opaqueEnd
        continue
      }
      const parsed = parseOpeningTagAt(out, openIndex)
      if (!parsed || parsed.isSelfClosing || !isModelScratchpadTagName(parsed.tagName)) {
        // Parsed ordinary tags own their quoted attributes. Do not rescan
        // attribute text as nested scratchpad markup (inv_ea9aab25c6ad4f7d).
        searchFrom = parsed ? openIndex + parsed.opener.length : openIndex + 1
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

  // A complete summary is usable even if the model forgot the leading
  // scratchpad's closing tag. Code/attribute literals are already masked.
  if (/^\s*<(?:analysis|assessment|thinking)\b/i.test(out)) {
    const summary = /<summary\b[^>]*>([\s\S]*)<\/summary\s*>\s*$/i.exec(out)
    if (summary) out = summary[1]
  }
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
  /\s*<\/(?:(?:\uFF5C\uFF5C|\|\|)DSML(?:\uFF5C\uFF5C|\|\|)\s*)?(?:parameter|invoke|tool_calls|tool_result)(?=[\s/>])[^>]*>\s*$/iu

/** Strips a trailing run of tool-protocol closing tags; does not touch tags in fences or inline code. */
export function stripTrailingToolProtocolClosingFragments(raw: string): string {
  // No suffix candidate means masking cannot remove anything. Avoid rescanning
  // the entire streamed accumulator for ordinary prose and fenced snippets.
  if (!raw || !TRAILING_TOOL_PROTOCOL_CLOSE_RE.test(raw)) return raw
  const { text: fenceMasked, fences, placeholderBase: fenceBase } = maskCodeFences(raw)
  const { text: indentedMasked, blocks, placeholderBase: indentedBase } = maskIndentedCodeBlocks(fenceMasked)
  const { text: inlineMasked, spans, placeholderBase: inlineBase } = maskInlineCodeSpans(indentedMasked)
  let out = inlineMasked
  for (;;) {
    const trailing = TRAILING_TOOL_PROTOCOL_CLOSE_RE.exec(out)
    if (!trailing) break
    // A backslash-escaped closing tag is literal text, not a protocol
    // fragment: check escape parity before removing each closing fragment,
    // consistently with scratchpad-tag handling (cherry-pr-review
    // inv_c4d88ac9b0f0f954).
    const tagIndex = trailing.index + trailing[0].indexOf('<')
    if (isBackslashEscaped(out, tagIndex)) break
    out = out.slice(0, trailing.index)
  }
  out = unmaskInlineCodeSpans(out, spans, inlineBase)
  out = unmaskIndentedCodeBlocks(out, blocks, indentedBase)
  return unmaskCodeFences(out, fences, fenceBase)
}
