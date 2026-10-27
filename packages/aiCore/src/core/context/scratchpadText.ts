/** Model scratchpad wrappers named in compaction prompts and observed in leaked transcripts. */
export const MODEL_SCRATCHPAD_TAG_NAMES = ['analysis', 'assessment', 'thinking'] as const

const MODEL_SCRATCHPAD_TAG_SET = new Set<string>(MODEL_SCRATCHPAD_TAG_NAMES)

type ParsedOpeningTag = {
  tagName: string
  opener: string
  isSelfClosing: boolean
}

/** Deterministic opener scan — avoids catastrophic backtracking from overlapping attribute regexes. */
export function parseOpeningTagAt(text: string, offset: number): ParsedOpeningTag | null {
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

/** HTML elements whose bodies are literal character data (RCDATA/RAWTEXT). */
const HTML_TEXT_ELEMENT_TAGS = new Set(['textarea', 'title', 'script', 'style'])

/**
 * End offset just past an HTML text element's body (its matching closing
 * tag), or text.length when unclosed, or null when the parsed opener is not
 * such an element: the body is literal character data, so wrapper-shaped
 * markup inside is text, not a scratchpad block (cherry-pr-review round-8
 * html-text-content-loss).
 */
function htmlTextElementEnd(text: string, parsed: ParsedOpeningTag, openIndex: number): number | null {
  if (parsed.isSelfClosing || !HTML_TEXT_ELEMENT_TAGS.has(parsed.tagName.toLowerCase())) return null
  const bodyStart = openIndex + parsed.opener.length
  const closeRe = new RegExp(`</${parsed.tagName.toLowerCase()}\\s*>`, 'i')
  const close = closeRe.exec(text.slice(bodyStart))
  return close ? bodyStart + close.index + close[0].length : text.length
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

/**
 * Opener tag of the HTML text element (script/style/textarea/title) left
 * unclosed at the end of `text`, outside code, or null. Incremental streaming
 * scans each delta with only a small carried prefix: once the element's
 * opener has been emitted, later deltas would scan its literal body as
 * ordinary markup and strip wrapper-shaped text inside it (cherry-pr-review
 * round-9 fragmented-html-content-corruption). The caller prepends the
 * returned opener to the next scan as context.
 */
export function unclosedHtmlTextElementOpener(text: string): string | null {
  const { text: fenceMasked } = maskCodeFences(text)
  const { text: indentedMasked } = maskIndentedCodeBlocks(fenceMasked)
  const { text: masked } = maskInlineCodeSpans(indentedMasked)
  let pos = 0
  while (pos < masked.length) {
    const start = masked.indexOf('<', pos)
    if (start === -1) return null
    const opaqueEnd = opaqueMarkupEnd(masked, start)
    if (opaqueEnd !== null) {
      pos = opaqueEnd
      continue
    }
    const parsed = isBackslashEscaped(masked, start) ? null : parseOpeningTagAt(masked, start)
    if (!parsed) {
      pos = start + 1
      continue
    }
    if (parsed.isSelfClosing || !HTML_TEXT_ELEMENT_TAGS.has(parsed.tagName.toLowerCase())) {
      pos = start + parsed.opener.length
      continue
    }
    const bodyStart = start + parsed.opener.length
    const closeRe = new RegExp(`</${parsed.tagName.toLowerCase()}\\s*>`, 'i')
    const close = closeRe.exec(masked.slice(bodyStart))
    // `start`/`bodyStart` index the MASKED text, whose placeholders differ in
    // length from the original code regions: slicing `text` with them returns
    // a shifted fragment (cherry-pr-review round-11 masked-html-carry). The
    // opener itself is outside code, so the masked scan saw it verbatim.
    if (!close) return parsed.opener
    pos = bodyStart + close.index + close[0].length
  }
  return null
}

/**
 * Opaque markup opener (HTML comment or CDATA section) left unclosed at the
 * end of `text`, outside code, or null. Same streaming-carry rationale as
 * unclosedHtmlTextElementOpener: once `<!--` or `<![CDATA[` has been emitted,
 * later deltas would scan its literal body as ordinary markup and strip
 * wrapper-shaped text inside it (cherry-pr-review round-11
 * opaque-markup-stream-context).
 */
export function unclosedOpaqueMarkupOpener(text: string): '<!--' | '<![CDATA[' | null {
  const { text: fenceMasked } = maskCodeFences(text)
  const { text: indentedMasked } = maskIndentedCodeBlocks(fenceMasked)
  const { text: masked } = maskInlineCodeSpans(indentedMasked)
  let pos = 0
  let open: '<!--' | '<![CDATA[' | null = null
  while (pos < masked.length) {
    if (open === null) {
      const lt = masked.indexOf('<', pos)
      if (lt === -1) return null
      if (masked.startsWith('<!--', lt)) {
        open = '<!--'
        pos = lt + 4
        continue
      }
      if (masked.startsWith('<![CDATA[', lt)) {
        open = '<![CDATA['
        pos = lt + 9
        continue
      }
      // Tag attributes are opaque to markup: a comment or CDATA opener inside
      // one is attribute text, not an open section (cherry-pr-review round-12
      // false-comment-carry).
      const parsed = isBackslashEscaped(masked, lt) ? null : parseOpeningTagAt(masked, lt)
      if (parsed) {
        pos = lt + parsed.opener.length
        continue
      }
      const closeTag = /^<\/[a-zA-Z][a-zA-Z0-9-]*\s*>/.exec(masked.slice(lt))
      pos = lt + (closeTag ? closeTag[0].length : 1)
      continue
    }
    const terminator = open === '<!--' ? '-->' : ']]>'
    const close = masked.indexOf(terminator, pos)
    if (close === -1) return open
    open = null
    pos = close + terminator.length
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

/** Expand indentation tabs at CommonMark's four-column tab stops. */
export function expandFencePrefixTabs(prefix: string): string {
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
      // Ordered-list markers allow at most nine digits (CommonMark 0.31.2
      // §5.2): more means no list item, so the fence opener that follows is
      // paragraph text, not a fence (cherry-pr-review round-7
      // overlong-list-phantom-fence).
      let digits = 0
      while (i < prefix.length && prefix[i] >= '0' && prefix[i] <= '9') {
        i++
        digits++
      }
      if (digits > 9) return false
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

/** An ordered list can interrupt a paragraph only when its start number is 1. */
function isInterruptingListItemStart(line: string): boolean {
  return /^(?: {0,3}> ?)* {0,3}(?:[-*+]|0*1[.)])(?:[ \t]+|$)/.test(line)
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
  let inList = false
  for (let pos = 0; pos <= index;) {
    const end = lineEndAfter(text, pos)
    const line = text.slice(pos, lineContentEnd(text, pos))
    const depth = explicitQuoteDepth(line)
    if (depth > 0 && depth !== quoteDepth) start = pos
    if (end > index) break
    if (isInlineBlockBoundary(line)) {
      start = end
      quoteDepth = 0
      inList = false
    } else {
      if (isInterruptingListItemStart(line) || (inList && isListItemStart(line))) {
        start = pos
        inList = true
      }
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
  const inList = isListItemStart(text.slice(currentStart, lineContentEnd(text, currentStart)))
  let quoteDepth = explicitQuoteDepth(text.slice(currentStart, lineContentEnd(text, currentStart)))
  for (let start = currentEnd; start < text.length; start = lineEndAfter(text, start)) {
    const line = text.slice(start, lineContentEnd(text, start))
    const depth = explicitQuoteDepth(line)
    if (
      isInlineBlockBoundary(line) ||
      isInterruptingListItemStart(line) ||
      (inList && isListItemStart(line)) ||
      (depth > 0 && depth !== quoteDepth)
    )
      return start
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

function fenceContainerEnd(text: string, openerLineEnd: number, openerPrefix: string, limit = text.length): number {
  const segments = parseFenceContainerSegments(openerPrefix)
  if (segments.length === 0) return limit
  for (let start = openerLineEnd; start < limit; start = lineEndAfter(text, start)) {
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
  return limit
}

/** Precompute list-container extents once instead of scanning every prefix per fence. */
function inheritedFencePrefixLookup(
  text: string,
  initialContainerPrefix?: string
): (openerStart: number, prefix: string) => string {
  const lists: Array<{ start: number; end: number; prefix: string }> = []
  // Incremental streaming seed: containers opened in text already consumed
  // before this chunk. The synthetic entry precedes every real line, so it
  // can never terminate or shadow a later same-chunk container refinement.
  if (initialContainerPrefix) {
    lists.push({ start: -1, end: Number.MAX_SAFE_INTEGER, prefix: initialContainerPrefix })
  }
  // A container stack across lines: a nested item's marker may sit more than
  // three columns from the line start, because enclosing items contribute
  // their content columns first (CommonMark 0.31.2 §5.2; cherry-pr-review
  // round-8 nested-fence-content-loss). Each entry's prefix is the canonical
  // virtual composition of the whole stack. Quoted lines keep the per-line
  // prefix model: quote markers must repeat on every line, so their nesting
  // never hides in bare indentation.
  const stack: Array<{ contentCol: number; start: number; index: number }> = []
  for (let start = 0; start < text.length; start = lineEndAfter(text, start)) {
    const line = expandFencePrefixTabs(text.slice(start, lineContentEnd(text, start)))
    // Blank lines may remain inside a list; they do not pop the stack.
    if (line.trim() === '') continue
    if (line.includes('>')) {
      const prefix = /^(?:(?: {0,3}> ?)|(?: {0,3}(?:[-*+]|\d{1,9}[.)]) +))+/.exec(line)?.[0]
      if (prefix && parseFenceContainerSegments(prefix).some((segment) => segment.type === 'list'))
        lists.push({ start, end: fenceContainerEnd(text, lineEndAfter(text, start), prefix), prefix })
      continue
    }
    const leading = line.match(/^ */)?.[0].length ?? 0
    // Sibling or dedented content ends the items it no longer reaches.
    while (stack.length && stack[stack.length - 1].contentCol > leading) {
      const ended = stack.pop()
      if (ended) lists[ended.index].end = start
    }
    const parentCol = stack.length ? stack[stack.length - 1].contentCol : 0
    if (leading - parentCol > 3) continue
    const marker = /^([-*+]|\d{1,9}[.)])( +|$)/.exec(line.slice(leading))
    if (!marker) continue
    const padding = marker[2] === '' ? 1 : Math.min(marker[2].length, 4)
    const contentCol = leading + marker[1].length + padding
    const relWidth = contentCol - parentCol
    const virtual = (stack.length ? lists[stack[stack.length - 1].index].prefix : '') + `-${' '.repeat(relWidth - 1)}`
    stack.push({ contentCol, start, index: lists.length })
    lists.push({ start, end: text.length, prefix: virtual })
  }
  return (openerStart, openerPrefix) => {
    if (openerPrefix === '' || parseFenceContainerSegments(openerPrefix).some((segment) => segment.type === 'list'))
      return openerPrefix
    let inherited = openerPrefix
    for (const list of lists) {
      if (list.start >= openerStart) break
      if (list.end <= openerStart) continue
      if (fenceCloseMatchesContainerContext(openerPrefix, list.prefix)) {
        inherited = list.prefix
        continue
      }
      // Nested-item openers: the line may reach the enclosing item's content
      // column and then open its own nested container(s) before the fence
      // marker (cherry-pr-review round-7 nested-fence-content-loss). Adopt
      // the enclosing list prefix with the nested segments appended, as a
      // canonical virtual prefix carrying the full container columns.
      const segments = parseFenceContainerSegments(list.prefix)
      const contentCol = segments.reduce((sum, segment) => sum + (segment.type === 'list' ? segment.contentCol : 0), 0)
      const expanded = expandFencePrefixTabs(openerPrefix)
      const leading = expanded.match(/^ */)?.[0].length ?? 0
      if (contentCol === 0 || leading < contentCol) continue
      const remainder = expanded.slice(contentCol)
      if (parseFenceContainerSegments(remainder).length === 0) continue
      if (!/^(?:(?: {0,3}> ?)|(?: {0,3}(?:[-*+]|\d{1,9}[.)]) +))* {0,3}$/.test(remainder)) continue
      const virtual =
        segments
          .map((segment) => (segment.type === 'quote' ? '> ' : `-${' '.repeat(segment.contentCol - 1)}`))
          .join('') + remainder
      inherited = virtual
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
  let boundaryStart = lineEndAfter(text, searchFrom)
  let pos = searchFrom
  while (pos < text.length) {
    const rel = text.slice(pos).search(/[`~]{3,}/)
    if (rel === -1) break
    const markerStart = pos + rel
    const candidateEnd = lineEndAfter(text, markerStart)
    const containerEnd = fenceContainerEnd(text, boundaryStart, openerPrefix, candidateEnd)
    if (containerEnd < candidateEnd) return containerEnd
    boundaryStart = candidateEnd
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
    return candidateEnd
  }
  const containerEnd = fenceContainerEnd(text, boundaryStart, openerPrefix)
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
  let cachedBlockEnd = -1
  while (searchFrom < text.length) {
    const openIndex = text.indexOf('<', searchFrom)
    if (openIndex === -1) break
    // Literal inline code ahead of the tag: complete spans are text, so a
    // wrapper-shaped tag inside one is not a boundary (cherry-pr-review
    // round-12 inline-code-range-discovery).
    const tick = text.indexOf('`', searchFrom)
    if (tick !== -1 && tick < openIndex && !isBackslashEscaped(text, tick)) {
      let run = 0
      while (text[tick + run] === '`') run++
      let j = tick + run
      let closedAt = -1
      const blockEnd = j < cachedBlockEnd ? cachedBlockEnd : (cachedBlockEnd = inlineBlockEnd(text, j))
      while (j < blockEnd) {
        if (text[j] !== '`') {
          j++
          continue
        }
        let closeRun = 0
        while (text[j + closeRun] === '`') closeRun++
        if (closeRun === run) {
          closedAt = j + closeRun
          break
        }
        j += closeRun
      }
      searchFrom = closedAt === -1 ? tick + run : closedAt
      continue
    }
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
    if (parsed) {
      const textElementEnd = htmlTextElementEnd(text, parsed, openIndex)
      if (textElementEnd !== null) {
        searchFrom = textElementEnd
        continue
      }
    }
    if (!parsed) {
      searchFrom = openIndex + 1
      continue
    }
    if (parsed.isSelfClosing || !isModelScratchpadTagName(parsed.tagName)) {
      // Consume the complete valid opening tag: its quoted attributes are
      // opaque to boundary discovery, so an attribute value like
      // title="<thinking>" cannot open a phantom block (cherry-pr-review
      // round-14 attribute-phantom-boundary).
      searchFrom = openIndex + parsed.opener.length
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
  return stripMarkdownContainerMarkersDetailed(line, []).content
}

/**
 * Marker stripping with indentation accounting: enclosing list continuation
 * columns are consumed level by level BEFORE any nested quote or list marker
 * (the spaces ahead of a nested marker are the outer list's continuation
 * indent, never the marker's own leading allowance), so the returned content's
 * leading columns are already relative to the innermost container
 * (cherry-pr-review inv_4f2b0c2d3f9c4a0b). Tab expansion alone must not count
 * as container removal: a tab-led line inside a list item keeps its inherited
 * indentation accounted through the walk (cherry-pr-review:
 * tab-analysis-retained). A nested item's own marker can sit at its parent's
 * content column, beyond the three optional columns measured from the raw
 * line start; consuming the enclosing continuation first lets the marker
 * pattern see it (cherry-pr-review: nested-list-code).
 */
function stripMarkdownContainerMarkersDetailed(
  line: string,
  enclosingLists: Array<{ column: number; quoteDepth: number }>
): {
  content: string
  strippedQuoteDepth: number
  ownListMarkerStripped: boolean
  markersStripped: boolean
} {
  let rest = expandFencePrefixTabs(line)
  let strippedQuoteDepth = 0
  let ownListMarkerStripped = false
  let markersStripped = false
  let level = 0
  // Column base of the current quote-depth segment: stacked list columns are
  // measured within the container that holds the list, so crossing a quote
  // marker restarts the column space at zero (cherry-pr-review
  // inv_43213537eba0ef5c).
  let base = 0
  for (;;) {
    if (level < enclosingLists.length && enclosingLists[level].quoteDepth === strippedQuoteDepth) {
      const need = enclosingLists[level].column - base
      const spaces = /^ */.exec(rest)?.[0].length ?? 0
      if (spaces >= need) {
        rest = rest.slice(need)
        base = enclosingLists[level].column
        level++
        continue
      }
      if (spaces > 0) {
        // The line dedents out of this item: its leading spaces belong to
        // shallower containers, so deeper items cannot continue here.
        rest = rest.slice(spaces)
        level = enclosingLists.length
        continue
      }
      base = enclosingLists[level].column
      level++
      continue
    }
    const quote = /^( {0,3})>[ ]?/.exec(rest)
    if (quote) {
      strippedQuoteDepth++
      markersStripped = true
      rest = rest.slice(quote[0].length)
      base = 0
      continue
    }
    if (level < enclosingLists.length && enclosingLists[level].quoteDepth > strippedQuoteDepth) {
      // A lazy continuation line may omit the quote markers between the text
      // and a list nested inside them; the list continuation still applies.
      const need = enclosingLists[level].column - base
      const spaces = /^ */.exec(rest)?.[0].length ?? 0
      if (spaces >= need) {
        rest = rest.slice(need)
        base = enclosingLists[level].column
        level++
        continue
      }
      if (spaces > 0) {
        rest = rest.slice(spaces)
        level = enclosingLists.length
        continue
      }
      base = enclosingLists[level].column
      level++
      continue
    }
    const list = /^( {0,3})([-*+]|\d{1,9}[.)])( +)/.exec(rest)
    if (!list) return { content: rest, strippedQuoteDepth, ownListMarkerStripped, markersStripped }
    ownListMarkerStripped = true
    markersStripped = true
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

function quoteMarkerPositions(line: string): { markerStarts: number[]; markerEnds: number[] } {
  const markerStarts: number[] = []
  const markerEnds: number[] = []
  let col = 0
  for (;;) {
    let spaces = 0
    while (line[col + spaces] === ' ') spaces++
    let matched = -1
    for (let k = Math.min(spaces, 3); k >= 0; k--) {
      if (line[col + k] === '>') {
        matched = k
        break
      }
    }
    if (matched === -1) break
    markerStarts.push(col + matched)
    let end = col + matched + 1
    if (line[end] === ' ') end++
    markerEnds.push(end)
    col = end
  }
  return { markerStarts, markerEnds }
}

export function maskIndentedCodeBlocksReference(text: string): {
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
  let listInsideQuote = false
  // Dedenting from a nested item may return to its outer list, not column zero.
  // Each entry's column is measured in the container holding the item, and
  // quoteDepth records which quote segment that container is (cherry-pr-review
  // inv_43213537eba0ef5c).
  const listColumnStack: Array<{ column: number; quoteDepth: number }> = []
  // List items enclosing the line being classified, outside in, captured
  // after dedent pops but before the line's own item is pushed. The detailed
  // stripper consumes their continuation columns so classification measures
  // indentation relative to the innermost container.
  let enclosingListStack: Array<{ column: number; quoteDepth: number }> = []
  const indentedCodeColumns = (line: string): number => {
    const { content } = stripMarkdownContainerMarkersDetailed(line, enclosingListStack)
    let columns = 0
    for (let k = 0; k < content.length; k++) {
      if (content[k] === ' ') columns += 1
      else if (content[k] === '\t') columns += 4 - (columns % 4)
      else break
    }
    return columns
  }
  const isIndentedCodeLine = (line: string): boolean => line.trim() !== '' && indentedCodeColumns(line) >= 4

  // CommonMark leaf blocks close a paragraph, so indentation after them
  // opens indented code rather than continuing paragraph text: an ATX
  // heading, a setext underline, a thematic break, or a masked fence block
  // (CommonMark 0.31.2 §4.4; cherry-pr-review inv_0847c277aaa83851). A setext
  // underline only closes an OPEN paragraph; on its own it is paragraph text.
  const isLeafBlockBoundaryLine = (line: string, paragraphWasOpen: boolean): boolean => {
    const stripped = stripMarkdownContainerMarkers(line)
    const content = stripped === line && inheritedListColumns > 0 ? stripped.slice(inheritedListColumns) : stripped
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
    const rawExpanded = expandFencePrefixTabs(line)
    const withoutQuote = rawExpanded.replace(/^(?: {0,3}> ?)+/, '')
    if (/^ {0,3}(?:[-*+]|\d{1,9}[.)]) +/.test(withoutQuote) && withoutQuote !== rawExpanded) listInsideQuote = true
    if (
      depth === 0 &&
      listInsideQuote &&
      line.trim() &&
      // An unmarked non-blank line can continue the open paragraph lazily
      // (CommonMark 0.31.2 §4.8): the quote - and the list state it owns -
      // ends only when the paragraph does not continue, so a lazy line keeps
      // the paragraph's ownership instead of being re-measured as top-level
      // indented code (cherry-pr-review round-14 lazy-quote-analysis).
      (!paragraphOpen || isLeafBlockBoundaryLine(line, paragraphOpen))
    ) {
      listInsideQuote = false
      // Leaving a quote closes only the lists the quote owned; enclosing
      // outer-list levels survive in their own column space, so a following
      // indented line is still measured against the outer item instead of
      // becoming top-level indented code (cherry-pr-review:
      // outer-list-analysis-retained).
      for (let k = listColumnStack.length - 1; k >= 0; k--) {
        if (listColumnStack[k].quoteDepth > 0) listColumnStack.splice(k, 1)
      }
      inheritedListColumns = listColumnStack[listColumnStack.length - 1]?.column ?? 0
      enclosingListStack = [...listColumnStack]
    }
    const expanded = listInsideQuote ? withoutQuote : rawExpanded
    // Nested items begin at their parent's content column, which can exceed
    // the three optional columns allowed relative to the current container.
    const nestedOffset =
      inheritedListColumns > 0 && expanded.startsWith(' '.repeat(inheritedListColumns)) ? inheritedListColumns : 0
    const list = /^( {0,3})([-*+]|\d{1,9}[.)])( +)(.*)$/.exec(expanded.slice(nestedOffset))
    if (list) {
      const padding = list[3].length <= 4 ? list[3].length : 1
      const nextColumns = nestedOffset + list[1].length + list[2].length + padding
      const markerColumn = nestedOffset + list[1].length
      while (listColumnStack.length) {
        const top = listColumnStack[listColumnStack.length - 1]
        // The new item's column is measured in its own quote segment: only
        // levels that segment owns compete on columns; outer-segment lists
        // enclose the quote and survive (cherry-pr-review:
        // outer-list-analysis-retained). A marker nests only in items whose
        // content column it reaches, so sibling markers at a shallower column
        // end every level above the marker's own column - not just levels at
        // or past the new item's content column (cherry-pr-review round-17
        // stale-sibling-ownership, CommonMark 0.31.2 ex313).
        if (top.quoteDepth > depth || (top.quoteDepth === depth && top.column > markerColumn)) {
          listColumnStack.pop()
        } else break
      }
      enclosingListStack = [...listColumnStack]
      listColumnStack.push({ column: nextColumns, quoteDepth: depth })
      inheritedListColumns = nextColumns
    } else if (expanded.trim() !== '') {
      const columns = expanded.length - expanded.trimStart().length
      // Lazy paragraph continuation (CommonMark 0.31.2 §5, §4.4): with a
      // paragraph open, a non-blank line without its own list marker that
      // does not start a leaf block continues the paragraph - it can never
      // open indented code, and the list structure it belongs to stays open
      // (cherry-pr-review: lazy-list-continuation).
      if (!paragraphOpen || explicitQuoteDepth(line) > 0 || isLeafBlockBoundaryLine(line, paragraphOpen)) {
        // Equal numeric quote depth does not imply equal container ownership.
        // Check the stack outside-in: the first level whose container this
        // line does not reach ends here, and every level inside it ends with
        // it. For a quote-owned list level, a line that opens a deeper quote
        // container reaches the item's content only when the deeper marker
        // begins at or past the item's column; a marker starting before it
        // opens a NEW container outside the item, so the item (and the
        // paragraph it carried) ends here (cherry-pr-review round-14
        // quote-container-ownership). A top-level list ends the same way
        // when the line's first marker starts before its content column,
        // and a level whose owning quote segment the line never enters is
        // stale even when its numeric depth matches the previous quote
        // (cherry-pr-review round-16 quote-list-code-deleted).
        const markers = depth > 0 ? quoteMarkerPositions(line) : null
        if (markers) {
          const markerCount = markers.markerStarts.length
          for (let k = 0; k < listColumnStack.length; k++) {
            const level = listColumnStack[k]
            let reached: boolean
            if (level.quoteDepth > markerCount) {
              reached = false
            } else if (level.quoteDepth === 0) {
              reached = markers.markerStarts[0] >= level.column
            } else if (level.quoteDepth < markerCount) {
              reached =
                markers.markerStarts[level.quoteDepth] - markers.markerEnds[level.quoteDepth - 1] >= level.column
            } else {
              reached = level.column <= columns
            }
            if (!reached) {
              listColumnStack.length = k
              break
            }
          }
        } else {
          while (listColumnStack.length && listColumnStack[listColumnStack.length - 1].column > columns) {
            listColumnStack.pop()
          }
        }
        inheritedListColumns = listColumnStack[listColumnStack.length - 1]?.column ?? 0
        enclosingListStack = [...listColumnStack]
      }
    }
    // A new explicit quote container cannot inherit an outer paragraph.
    // Unmarked lazy continuation lines keep their paragraph's container. A
    // marked line with FEWER quote markers than the paragraph's depth also
    // continues that paragraph lazily - indented code cannot interrupt a
    // paragraph (CommonMark 0.31.2 §4.4, §5.1) - so the missing deeper
    // markers must not re-open code classification (cherry-pr-review
    // round-16 lazy-quote-analysis-retained).
    const lazyDepthDecrease = paragraphOpen && depth > 0 && depth < quoteDepth
    if (
      (depth > 0 && depth !== quoteDepth && !lazyDepthDecrease) ||
      isListItemStart(line) ||
      previousListColumns !== inheritedListColumns
    )
      paragraphOpen = false
    if (depth > 0) quoteDepth = depth
    if (line.trim() === '' || isContainerOnlyLine(line)) {
      paragraphOpen = false
      // A raw blank line (no quote marker) ends its blockquote: list state
      // the quote owned dies with it, while list levels outside any quote
      // survive (blank lines do not end lists). A following quote is a fresh
      // blockquote, not a continuation (cherry-pr-review:
      // separate-quote-list-state).
      if (line.trim() === '') {
        listInsideQuote = false
        for (let k = listColumnStack.length - 1; k >= 0; k--) {
          if (listColumnStack[k].quoteDepth > 0) listColumnStack.splice(k, 1)
        }
        inheritedListColumns = listColumnStack[listColumnStack.length - 1]?.column ?? 0
        enclosingListStack = [...listColumnStack]
      }
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

// ---------------------------------------------------------------------------
// Phase-1 extraction (LOCAL, unpublished): the maskIndentedCodeBlocks loop as
// an explicit per-line state machine. maskIndentedCodeBlocksStepped must be
// byte-identical to maskIndentedCodeBlocks; the original stays as the
// reference implementation until corpus + suite validation proves identity.
// ---------------------------------------------------------------------------

/** Cross-line classification state of the indented-code masker. */
export interface IndentedMaskState {
  inheritedListColumns: number
  listInsideQuote: boolean
  listColumnStack: Array<{ column: number; quoteDepth: number }>
  enclosingListStack: Array<{ column: number; quoteDepth: number }>
  paragraphOpen: boolean
  quoteDepth: number
  scratchpadScan: { pos: number; stack: string[] }
  run: {
    lines: Array<{ text: string; ending: string }>
    lastContent: number
    enclosingListStack: Array<{ column: number; quoteDepth: number }>
  } | null
}

export function initialIndentedMaskState(): IndentedMaskState {
  return {
    inheritedListColumns: 0,
    listInsideQuote: false,
    listColumnStack: [],
    enclosingListStack: [],
    paragraphOpen: false,
    quoteDepth: 0,
    scratchpadScan: { pos: 0, stack: [] },
    run: null
  }
}

interface IndentedMaskContext {
  text: string
  inlineRanges: Array<{ start: number; end: number }>
  placeholderBase: string
  blocks: string[]
  outLines: string[]
  // Lines of the currently open run that were already emitted by an earlier
  // incremental scan: the first closed run of this scan drops them from the
  // masked block so committed text is never re-emitted.
  committedRunLines?: number
}

function indentedCodeColumnsFor(
  line: string,
  enclosingListStack: Array<{ column: number; quoteDepth: number }>
): number {
  const { content } = stripMarkdownContainerMarkersDetailed(line, enclosingListStack)
  let columns = 0
  for (let k = 0; k < content.length; k++) {
    if (content[k] === ' ') columns += 1
    else if (content[k] === '\t') columns += 4 - (columns % 4)
    else break
  }
  return columns
}

export function isIndentedCodeLineFor(
  line: string,
  enclosingListStack: Array<{ column: number; quoteDepth: number }>
): boolean {
  return line.trim() !== '' && indentedCodeColumnsFor(line, enclosingListStack) >= 4
}

/**
 * Close a buffered indented-code run, mirroring the original forward scan's
 * emissions exactly.
 */
export function closeIndentedMaskRun(state: IndentedMaskState, ctx: IndentedMaskContext): void {
  const run = state.run
  if (!run) return
  const committed = ctx.committedRunLines ?? 0
  ctx.committedRunLines = 0
  if (committed > 0) {
    run.lines = run.lines.slice(committed)
    run.lastContent -= committed
  }
  if (run.lastContent < 0) {
    // Only trailing blank lines remain after dropping committed lines: they
    // pass through verbatim and no block is recorded.
    for (const entry of run.lines) ctx.outLines.push(entry.text + entry.ending)
    state.run = null
    return
  }
  ctx.blocks.push(
    run.lines
      .slice(0, run.lastContent + 1)
      .map((entry, j) => entry.text + (j < run.lastContent ? entry.ending : ''))
      .join('')
  )
  ctx.outLines.push(
    `${ctx.placeholderBase}INDENTED_CODE_${ctx.blocks.length - 1}\uE001${run.lines[run.lastContent].ending}`
  )
  for (let j = run.lastContent + 1; j < run.lines.length; j++) {
    ctx.outLines.push(run.lines[j].text + run.lines[j].ending)
  }
  state.run = null
}

/**
 * One line of the maskIndentedCodeBlocks main loop. `offset` is the line's
 * absolute start in ctx.text (for the shared scratchpad scan cursor).
 * Re-derived from the round-16 forward scan: keep in lockstep with
 * maskIndentedCodeBlocksReference.
 */
/**
 * Whether a line is a leaf block boundary (heading, thematic break, masked
 * fence, setext underline under an open paragraph). Module-level so the
 * streaming carry can reuse the exact predicate the stepper uses; the
 * stepper's closure delegates here (round-17 latency).
 */
export function isLeafBlockBoundaryLineFor(
  l: string,
  paragraphWasOpen: boolean,
  inheritedListColumns: number
): boolean {
  const stripped = stripMarkdownContainerMarkers(l)
  const content = stripped === l && inheritedListColumns > 0 ? stripped.slice(inheritedListColumns) : stripped
  if (/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(content)) return true
  if (/^ {0,3}(?:\*[ \t]*){3,}$/.test(content)) return true
  if (/^ {0,3}(?:_[ \t]*){3,}$/.test(content)) return true
  if (/^ {0,3}(?:-[ \t]*){3,}$/.test(content)) return true
  if (/^[\uE000-\uF8FF]CODE_FENCE_\d+\uE001[ \t]*$/.test(content.trim())) return true
  if (paragraphWasOpen && /^ {0,3}(?:=+|-+)[ \t]*$/.test(content)) return true
  return false
}

/**
 * Whether an emitted open line continues a paragraph after the stepped
 * state, mirroring indentedMaskStep's paragraphOpen outcome for a content
 * line without running the full mask pipeline (round-17 latency). Callers
 * must full-carry marker-prefix, quote, and whitespace-only lines instead.
 */
export function openLineParagraphContinuation(openLine: string, state: IndentedMaskState): boolean {
  if (state.run) {
    if (openLine.trim() === '' || isIndentedCodeLineFor(openLine, state.run.enclosingListStack)) return false
  }
  const expanded = expandFencePrefixTabs(openLine)
  if (/^( {0,3})([-*+]|\d{1,9}[.)])( +)/.test(expanded)) {
    return !isLeafBlockBoundaryLineFor(openLine, false, state.inheritedListColumns)
  }
  if (state.paragraphOpen || !isIndentedCodeLineFor(openLine, state.enclosingListStack)) {
    return !isLeafBlockBoundaryLineFor(openLine, state.paragraphOpen, state.inheritedListColumns)
  }
  return false
}

/**
 * Earliest backtick run that can still pair forward into later streamed
 * text. Reuses the reference pairing (maskInlineCodeSpans): runs inside a
 * matched span are inline-stable; anything unmatched may still close in a
 * later chunk and must stay in the streaming carry.
 */
export function inlineCodeCarryStart(text: string): number {
  // No backticks means no span can open or close: the answer is the whole
  // line without running the full span pipeline (round-17 latency: the
  // streaming carry asks this per delta over a growing open line).
  if (text.indexOf('`') === -1) return text.length
  const { ranges } = maskInlineCodeSpans(text)
  let rangeIdx = 0
  let pos = 0
  for (;;) {
    const tick = text.indexOf('`', pos)
    if (tick === -1) return text.length
    while (rangeIdx < ranges.length && ranges[rangeIdx].end <= tick) rangeIdx++
    if (rangeIdx < ranges.length && tick >= ranges[rangeIdx].start) {
      pos = ranges[rangeIdx].end
      continue
    }
    return tick
  }
}

export function indentedMaskStep(
  state: IndentedMaskState,
  line: string,
  ending: string,
  offset: number,
  ctx: IndentedMaskContext
): void {
  // Lines consumed into an open code run keep the run-start classification
  // context, exactly like the original forward scan, which never updates
  // container or paragraph state for run lines.
  if (state.run) {
    if (line.trim() === '' || isIndentedCodeLineFor(line, state.run.enclosingListStack)) {
      state.run.lines.push({ text: line, ending })
      if (line.trim() !== '') state.run.lastContent = state.run.lines.length - 1
      return
    }
    closeIndentedMaskRun(state, ctx)
  }

  const isLeafBlockBoundaryLine = (l: string, paragraphWasOpen: boolean): boolean =>
    isLeafBlockBoundaryLineFor(l, paragraphWasOpen, state.inheritedListColumns)

  const depth = explicitQuoteDepth(line)
  const previousListColumns = state.inheritedListColumns
  const rawExpanded = expandFencePrefixTabs(line)
  const withoutQuote = rawExpanded.replace(/^(?: {0,3}> ?)+/, '')
  if (/^ {0,3}(?:[-*+]|\d{1,9}[.)]) +/.test(withoutQuote) && withoutQuote !== rawExpanded) state.listInsideQuote = true
  if (
    depth === 0 &&
    state.listInsideQuote &&
    line.trim() &&
    // Lazy paragraph continuation guard (round-14): see the reference loop.
    (!state.paragraphOpen || isLeafBlockBoundaryLine(line, state.paragraphOpen))
  ) {
    state.listInsideQuote = false
    for (let k = state.listColumnStack.length - 1; k >= 0; k--) {
      if (state.listColumnStack[k].quoteDepth > 0) state.listColumnStack.splice(k, 1)
    }
    state.inheritedListColumns = state.listColumnStack[state.listColumnStack.length - 1]?.column ?? 0
    state.enclosingListStack = [...state.listColumnStack]
  }
  const expanded = state.listInsideQuote ? withoutQuote : rawExpanded
  const nestedOffset =
    state.inheritedListColumns > 0 && expanded.startsWith(' '.repeat(state.inheritedListColumns))
      ? state.inheritedListColumns
      : 0
  const list = /^( {0,3})([-*+]|\d{1,9}[.)])( +)(.*)$/.exec(expanded.slice(nestedOffset))
  if (list) {
    const padding = list[3].length <= 4 ? list[3].length : 1
    const nextColumns = nestedOffset + list[1].length + list[2].length + padding
    const markerColumn = nestedOffset + list[1].length
    while (state.listColumnStack.length) {
      const top = state.listColumnStack[state.listColumnStack.length - 1]
      // See the reference loop: sibling markers at a shallower column end
      // every level above the marker's own column (cherry-pr-review round-17
      // stale-sibling-ownership, CommonMark 0.31.2 ex313).
      if (top.quoteDepth > depth || (top.quoteDepth === depth && top.column > markerColumn)) {
        state.listColumnStack.pop()
      } else break
    }
    state.enclosingListStack = [...state.listColumnStack]
    state.listColumnStack.push({ column: nextColumns, quoteDepth: depth })
    state.inheritedListColumns = nextColumns
  } else if (expanded.trim() !== '') {
    const columns = expanded.length - expanded.trimStart().length
    // Lazy paragraph continuation guard (rounds 14-16): see the reference loop.
    if (!state.paragraphOpen || explicitQuoteDepth(line) > 0 || isLeafBlockBoundaryLine(line, state.paragraphOpen)) {
      // Outside-in container-ownership walk (round-16): see the reference loop.
      const markers = depth > 0 ? quoteMarkerPositions(line) : null
      if (markers) {
        const markerCount = markers.markerStarts.length
        for (let k = 0; k < state.listColumnStack.length; k++) {
          const level = state.listColumnStack[k]
          let reached: boolean
          if (level.quoteDepth > markerCount) {
            reached = false
          } else if (level.quoteDepth === 0) {
            reached = markers.markerStarts[0] >= level.column
          } else if (level.quoteDepth < markerCount) {
            reached = markers.markerStarts[level.quoteDepth] - markers.markerEnds[level.quoteDepth - 1] >= level.column
          } else {
            reached = level.column <= columns
          }
          if (!reached) {
            state.listColumnStack.length = k
            break
          }
        }
      } else {
        while (
          state.listColumnStack.length &&
          state.listColumnStack[state.listColumnStack.length - 1].column > columns
        ) {
          state.listColumnStack.pop()
        }
      }
      state.inheritedListColumns = state.listColumnStack[state.listColumnStack.length - 1]?.column ?? 0
      state.enclosingListStack = [...state.listColumnStack]
    }
  }
  // Lazy depth decrease keeps the paragraph (round-16): see the reference loop.
  const lazyDepthDecrease = state.paragraphOpen && depth > 0 && depth < state.quoteDepth
  if (
    (depth > 0 && depth !== state.quoteDepth && !lazyDepthDecrease) ||
    isListItemStart(line) ||
    previousListColumns !== state.inheritedListColumns
  )
    state.paragraphOpen = false
  if (depth > 0) state.quoteDepth = depth
  if (line.trim() === '' || isContainerOnlyLine(line)) {
    state.paragraphOpen = false
    if (line.trim() === '') {
      // A raw blank line ends its blockquote (separate-quote-list-state).
      state.listInsideQuote = false
      for (let k = state.listColumnStack.length - 1; k >= 0; k--) {
        if (state.listColumnStack[k].quoteDepth > 0) state.listColumnStack.splice(k, 1)
      }
      state.inheritedListColumns = state.listColumnStack[state.listColumnStack.length - 1]?.column ?? 0
      state.enclosingListStack = [...state.listColumnStack]
    }
    ctx.outLines.push(line + ending)
    return
  }
  if (state.paragraphOpen || !isIndentedCodeLineFor(line, state.enclosingListStack)) {
    state.paragraphOpen = !isLeafBlockBoundaryLine(line, state.paragraphOpen)
    ctx.outLines.push(line + ending)
    return
  }
  if (enclosingScratchpadTag(ctx.text, offset, ctx.inlineRanges, state.scratchpadScan) !== null) {
    state.paragraphOpen = true
    ctx.outLines.push(line + ending)
    return
  }
  // Run start: buffer instead of forward-scanning; the run closes on its
  // terminating line or at end of input (flushIndentedMaskRun).
  state.run = {
    lines: [{ text: line, ending }],
    lastContent: 0,
    enclosingListStack: [...state.enclosingListStack]
  }
  state.paragraphOpen = false
}

/** End-of-input flush: close a run the forward scan would have closed at lines.length. */
export function flushIndentedMaskRun(state: IndentedMaskState, ctx: IndentedMaskContext): void {
  closeIndentedMaskRun(state, ctx)
}

export function cloneIndentedMaskState(state: IndentedMaskState): IndentedMaskState {
  return {
    inheritedListColumns: state.inheritedListColumns,
    listInsideQuote: state.listInsideQuote,
    listColumnStack: state.listColumnStack.map((entry) => ({ ...entry })),
    enclosingListStack: state.enclosingListStack.map((entry) => ({ ...entry })),
    paragraphOpen: state.paragraphOpen,
    quoteDepth: state.quoteDepth,
    scratchpadScan: { pos: state.scratchpadScan.pos, stack: [...state.scratchpadScan.stack] },
    run: state.run
      ? {
          lines: state.run.lines.map((line) => ({ ...line })),
          lastContent: state.run.lastContent,
          enclosingListStack: state.run.enclosingListStack.map((entry) => ({ ...entry }))
        }
      : null
  }
}

/**
 * Advance a carried mask state over newly committed text without producing
 * masked output. A trailing indented run stays pending (no flush): its
 * classification resolves when later lines arrive or the stream ends.
 */
/**
 * Canonical virtual container prefix for an open list stack, matching the
 * composition inheritedFencePrefixLookup builds from same-text lines:
 * quote segments as '> ', list segments as '-' followed by (relative width
 * - 1) spaces, outermost first. Quote-wrapped list columns in the state are
 * relative to their stripped quote markers, so the quote segments must be
 * re-emitted before a list segment whose quoteDepth rises. Seeded into
 * maskCodeFences so a chunk whose container opener was consumed earlier
 * still classifies indented fence openers as fences (round-17).
 */
export function fenceContainerPrefixFromState(state: IndentedMaskState): string {
  let prefix = ''
  let prevCol = 0
  let prevQuote = 0
  for (const entry of state.listColumnStack) {
    while (prevQuote < entry.quoteDepth) {
      prefix += '> '
      prevQuote++
    }
    const relWidth = entry.column - prevCol
    if (relWidth <= 0) continue
    prefix += `-${' '.repeat(relWidth - 1)}`
    prevCol = entry.column
  }
  return prefix
}

export function advanceIndentedMaskState(state: IndentedMaskState, text: string): void {
  const lines = text.split(/\r\n|\r|\n/)
  const endings = text.match(/\r\n|\r|\n/g) ?? []
  const ctx: IndentedMaskContext = {
    text,
    inlineRanges: maskInlineCodeSpans(text).ranges,
    placeholderBase: pickPlaceholderBase(text, 'INDENTED_CODE'),
    blocks: [],
    outLines: []
  }
  let offset = 0
  // Step complete lines only: the final segment after the last newline is the
  // still-open line (or an empty artifact of split) and must not be
  // classified yet - line-based decisions need the whole line.
  for (let i = 0; i < endings.length; i++) {
    indentedMaskStep(state, lines[i], endings[i], offset, ctx)
    offset += lines[i].length + endings[i].length
  }
  // Rebase the shared scratchpad cursor onto the next chunk: positions in the
  // state's scan cursor refer to this chunk's text; the enclosing tag stack
  // carries over by name.
  state.scratchpadScan = { pos: 0, stack: state.scratchpadScan.stack }
}

/** Reference-equal driver: byte-identical to maskIndentedCodeBlocks (validated locally). */

export function maskIndentedCodeBlocks(text: string): {
  text: string
  blocks: string[]
  placeholderBase: string
} {
  return maskIndentedCodeBlocksStepped(text)
}
export function maskIndentedCodeBlocksStepped(
  text: string,
  options?: { initialState?: IndentedMaskState }
): {
  text: string
  blocks: string[]
  placeholderBase: string
  state: IndentedMaskState
} {
  const placeholderBase = pickPlaceholderBase(text, 'INDENTED_CODE')
  const blocks: string[] = []
  const lines = text.split(/\r\n|\r|\n/)
  const endings = text.match(/\r\n|\r|\n/g) ?? []
  const inlineRanges = maskInlineCodeSpans(text).ranges
  const state = options?.initialState ? cloneIndentedMaskState(options.initialState) : initialIndentedMaskState()
  // Rebase the shared scratchpad cursor onto this scan's text: positions in a
  // carried state refer to previously scanned text; the enclosing tag stack
  // carries over by name.
  state.scratchpadScan = { pos: 0, stack: state.scratchpadScan.stack }
  const ctx: IndentedMaskContext = { text, inlineRanges, placeholderBase, blocks, outLines: [] }
  if (options?.initialState?.run) ctx.committedRunLines = options.initialState.run.lines.length
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    indentedMaskStep(state, lines[i], endings[i] ?? '', offset, ctx)
    offset += lines[i].length + (endings[i]?.length ?? 0)
  }
  flushIndentedMaskRun(state, ctx)
  return { text: ctx.outLines.join(''), blocks, placeholderBase, state }
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
    const textElementEnd = htmlTextElementEnd(text, parsed, lt)
    if (textElementEnd !== null) {
      i = textElementEnd
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

export function maskCodeFences(
  text: string,
  options?: { initialContainerPrefix?: string }
): {
  text: string
  fences: string[]
  placeholderBase: string
} {
  const placeholderBase = pickPlaceholderBase(text, 'CODE_FENCE')
  const fences: string[] = []
  const inlineRanges = maskInlineCodeSpans(text).ranges
  const scratchpadScan = { pos: 0, stack: [] as string[] }
  let out = ''
  const inheritedPrefix = inheritedFencePrefixLookup(text, options?.initialContainerPrefix)
  let pos = 0
  // HTML comments and CDATA sections are opaque character data: a fence
  // marker inside one is literal text, never a Markdown fence
  // (cherry-pr-review round-13 comment-fence-retains-analysis). The cursor
  // advances monotonically with `pos`, keeping the scan linear; tag
  // attributes and closing tags are skipped like in
  // unclosedOpaqueMarkupOpener (round-12 false-comment-carry).
  const mayHaveOpaqueMarkup = text.includes('<!--') || text.includes('<![CDATA[')
  let opaqueScanPos = 0
  let opaqueUntil = -1
  const isInsideOpaqueMarkup = (index: number): boolean => {
    if (!mayHaveOpaqueMarkup) return false
    for (;;) {
      if (opaqueUntil !== -1) {
        if (index < opaqueUntil) return true
        opaqueUntil = -1
      }
      const lt = text.indexOf('<', opaqueScanPos)
      if (lt === -1) return false
      if (lt > index) {
        opaqueScanPos = lt
        return false
      }
      if (text.startsWith('<!--', lt) || text.startsWith('<![CDATA[', lt)) {
        const end = opaqueMarkupEnd(text, lt)!
        if (index < end) {
          opaqueUntil = end
          return true
        }
        opaqueScanPos = end
        continue
      }
      const parsed = isBackslashEscaped(text, lt) ? null : parseOpeningTagAt(text, lt)
      if (parsed) {
        opaqueScanPos = lt + parsed.opener.length
        continue
      }
      const closeTag = /^<\/[a-zA-Z][a-zA-Z0-9-]*\s*>/.exec(text.slice(lt))
      opaqueScanPos = lt + (closeTag ? closeTag[0].length : 1)
    }
  }

  while (pos < text.length) {
    const rel = text.slice(pos).search(/[`~]{3,}/)
    if (rel === -1) {
      out += text.slice(pos)
      break
    }
    const markerStart = pos + rel
    if (isInsideOpaqueMarkup(markerStart)) {
      // Literal character data: emit through the candidate and continue.
      out += text.slice(pos, markerStart + 1)
      pos = markerStart + 1
      continue
    }
    const markerLineStart = lineStartBefore(text, markerStart)
    const markerPrefix = text.slice(markerLineStart, markerStart)
    const inheritedMarkerPrefix = inheritedPrefix(markerLineStart, markerPrefix)
    const inheritedContainer = parseFenceContainerSegments(inheritedMarkerPrefix)
    const inheritedColumns = inheritedContainer.reduce(
      (sum, segment) => sum + (segment.type === 'list' ? segment.contentCol : 0),
      0
    )
    // The inheritance lookup already validated the opener prefix against the
    // list's container context (quote markers repeated, content column
    // reached, at most three marker-offset columns left) through
    // fenceCloseMatchesContainerContext; an adopted prefix means the fence is
    // a valid continuation whether or not the markers are bare spaces
    // (cherry-pr-review: quoted-list-fence-content-loss).
    const listContinuationFence = inheritedColumns > 0 && inheritedMarkerPrefix !== markerPrefix
    if (!isCodeFenceMarkerAtLineStart(text, markerStart) && !listContinuationFence) {
      out += text.slice(pos, markerStart + 1)
      pos = markerStart + 1
      continue
    }
    const fenceStart = listContinuationFence ? markerLineStart : fenceLinePrefixStart(text, markerStart)
    out += text.slice(pos, fenceStart)
    const openMatch = text.slice(markerStart).match(/^([`~])\1{2,}/)
    if (!openMatch) {
      // A mixed backtick/tilde run is no fence opener. Emit through the
      // candidate marker and continue AFTER it: resetting to fenceStart + 1
      // lands before the marker when a container prefix (e.g. '- ') makes
      // fenceStart < markerStart, re-selecting the same candidate forever
      // and freezing the main process (cherry-pr-review
      // inv_4f2b0c2d3f9c4a0b).
      out += text.slice(fenceStart, markerStart + 1)
      pos = markerStart + 1
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
      let inMarkup: ((index: number) => boolean) | undefined
      const findBlockClose = (from: number): number => {
        const closer = new RegExp(`</(?:${scratchpadScan.stack.join('|')})\\s*>`, 'gi')
        closer.lastIndex = from
        let match: RegExpExecArray | null
        while ((match = closer.exec(text)) !== null) {
          if (isBackslashEscaped(text, match.index) || (inMarkup ??= htmlOpeningTagLookup(text))(match.index)) continue
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
/**
 * A `<` can only begin markup when what follows can still become a tag: a
 * name of letters, digits and hyphens, then whitespace, attributes, `/` or
 * `>`. Any other character right after the name (the comma in `a<b, c`)
 * disproves the candidate, so buffered ordinary text is released instead of
 * stalling the stream until block stop (cherry-pr-review:
 * comparison-stream-stall).
 */
export function isPlausiblePartialTag(text: string, start: number): boolean {
  let i = start + 1
  if (text[i] === '/') i++
  if (i >= text.length) return true
  const char = text[i]
  if (char === '!' || char === '?') return true
  if (!/[a-z]/i.test(char)) return false
  i++
  while (i < text.length && /[a-z0-9-]/i.test(text[i])) i++
  let quote = ''
  for (; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === '>') return true
    if (/\s/.test(c) || c === '/' || c === '=') continue
    if (/[a-z0-9_.:-]/i.test(c)) continue
    return false
  }
  return true
}

function textHasIncompleteMarkup(text: string): boolean {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '<' || isBackslashEscaped(text, start) || !/^<(?:[a-z/!?]|$)/i.test(text.slice(start))) continue
    if (!isPlausiblePartialTag(text, start)) continue
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

function textHasUnclosedScratchpad(
  text: string,
  initialContainerPrefix?: string,
  initialMaskState?: IndentedMaskState
): boolean {
  if (!/<(?:analysis|assessment|thinking)\b/i.test(text)) return false
  const fenced = maskCodeFences(text, { initialContainerPrefix }).text
  // With a carried mask state, container ancestry of already-emitted lines
  // decides code vs paragraph: a 4-space wrapper opener continuing a list
  // item is paragraph content (defer and strip), not indented code
  // (round-17 multi-chunk partition finding).
  const indented = initialMaskState
    ? maskIndentedCodeBlocksStepped(fenced, { initialState: initialMaskState }).text
    : maskIndentedCodeBlocks(fenced).text
  return enclosingScratchpadTag(indented, indented.length) !== null
}

/** True when scratchpad filtering should wait for more stream input before stripping. */
export function shouldDeferScratchpadStripping(
  text: string,
  options?: { initialContainerPrefix?: string; initialMaskState?: IndentedMaskState }
): boolean {
  const seed = options?.initialContainerPrefix
  return (
    textHasIncompleteMarkup(text) ||
    textHasUnclosedScratchpad(text, seed, options?.initialMaskState) ||
    textHasUnclosedCodeFence(text, { initialContainerPrefix: seed }) ||
    textEndsWithPartialFenceMarker(text) ||
    textHasUnclosedInlineCode(/[`~]{3}/.test(text) ? maskCodeFences(text, { initialContainerPrefix: seed }).text : text)
  )
}

/** True when the text opens a fenced code block that has no closing delimiter yet. */
/** Position of the first code fence still open at the end of `text`, if any. */
function findUnclosedCodeFence(text: string, initialContainerPrefix?: string): { markerStart: number } | null {
  const inheritedPrefix = inheritedFencePrefixLookup(text, initialContainerPrefix)
  let pos = 0
  while (pos < text.length) {
    const rel = text.slice(pos).search(/[`~]{3,}/)
    if (rel === -1) return null
    const markerStart = pos + rel
    // Mirror maskCodeFences: an opener indented under a list container
    // (in the same text, or seeded from the streaming mask state) is a
    // valid continuation fence (round-17 spanning-fence case).
    const markerLineStart = lineStartBefore(text, markerStart)
    const markerPrefix = text.slice(markerLineStart, markerStart)
    const inheritedMarkerPrefix = inheritedPrefix(markerLineStart, markerPrefix)
    const inheritedContainer = parseFenceContainerSegments(inheritedMarkerPrefix)
    const inheritedColumns = inheritedContainer.reduce(
      (sum, segment) => sum + (segment.type === 'list' ? segment.contentCol : 0),
      0
    )
    const listContinuationFence = inheritedColumns > 0 && inheritedMarkerPrefix !== markerPrefix
    if (!isCodeFenceMarkerAtLineStart(text, markerStart) && !listContinuationFence) {
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
    const openerLineStart = listContinuationFence ? markerLineStart : fenceLinePrefixStart(text, markerStart)
    const closeEnd = findCodeFenceClose(
      text,
      afterOpen,
      fenceChar,
      fenceLen,
      text.slice(openerLineStart, markerStart),
      inheritedPrefix
    )
    if (closeEnd === -1) return { markerStart }
    pos = closeEnd
  }
  return null
}

export function textHasUnclosedCodeFence(text: string, options?: { initialContainerPrefix?: string }): boolean {
  return findUnclosedCodeFence(text, options?.initialContainerPrefix) !== null
}

/**
 * textHasUnclosedInlineCode restricted to inline contexts: fenced and indented
 * code blocks are masked first, so a fence opener's own backticks do not read
 * as an unclosed inline span. A genuinely unmatched inline backtick can still
 * pair forward with later streamed text and reclassify a scratchpad boundary,
 * so callers hold the probe while this is true (cherry-pr-review round-9
 * initial-probe-stalls-code-stream).
 */
export function textHasUnclosedInlineCodeOutsideCodeBlocks(text: string): boolean {
  const { text: fenceMasked } = maskCodeFences(text)
  const { text: indentedMasked } = maskIndentedCodeBlocks(fenceMasked)
  return textHasUnclosedInlineCode(indentedMasked)
}

/**
 * Confirmed-open code fence for incremental streaming: the opener line is
 * complete (the info string can no longer change), the fence is still open
 * at the end of `text`, and it sits outside any scratchpad block. The
 * returned opener line (with its ending) is carried into the next streamed
 * scan for fence context; content through `stableEnd` - every complete
 * content line - is stable literal text that can be emitted immediately
 * instead of buffering the whole fence (cherry-pr-review
 * inv_4f2b0c2d3f9c4a0b). Only the trailing partial line can still become
 * the closing marker, so it stays buffered.
 */
export function confirmedOpenFenceStreamPrefix(
  text: string,
  options?: { initialContainerPrefix?: string }
): { openerLine: string; stableEnd: number } | null {
  const fence = findUnclosedCodeFence(text, options?.initialContainerPrefix)
  if (!fence) return null
  // A fence inside a scratchpad block ends at the block's closer: its
  // content is private and must never stream early.
  if (enclosingScratchpadTag(text, fence.markerStart) !== null) return null
  const openerLineEnd = lineEndAfter(text, fence.markerStart)
  if (openerLineEnd >= text.length) return null
  const stableEnd = lineStartBefore(text, text.length)
  if (stableEnd <= openerLineEnd) return null
  return { openerLine: text.slice(lineStartBefore(text, fence.markerStart), openerLineEnd), stableEnd }
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

/**
 * Complete leading markup that cannot open a model scratchpad wrapper: a
 * non-scratchpad opening tag, a complete self-closing tag, or a complete HTML
 * comment. Unlike textStartsWithNonScratchpadOpeningTag this also releases
 * `<br/>` / `<hr />` / `<!-- comment -->` prefixes, which hold a parentless
 * answer's whole probe pending until block end otherwise (cherry-pr-review
 * ordinary-markup-stream-stall). An unclosed comment stays unreleased: it may
 * still swallow later markup.
 */
export function textStartsWithCompleteNonScratchpadMarkup(text: string): boolean {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('<') || !trimmed.includes('>')) {
    return false
  }
  if (trimmed.startsWith('<!--')) {
    // `<!-->` and `<!--->` are complete empty comments (HTML5 abrupt closing).
    if (trimmed.startsWith('<!-->') || trimmed.startsWith('<!--->')) {
      return true
    }
    return trimmed.indexOf('-->', 4) !== -1
  }
  const parsed = parseLeadingOpeningTag(trimmed)
  if (!parsed) {
    return false
  }
  return !isModelScratchpadTagName(parsed.tagName)
}

/** Strips known scratchpad wrappers without touching fenced code blocks. */
/**
 * Incremental-strip prototype entry (round-17): identical pipeline to
 * stripKnownModelScratchpadBlocksPreservingCodeFences, but the indented-code
 * mask starts from a carried state advanced over previously committed
 * (fence-masked) text instead of re-deriving container ownership from a
 * reconstructed prefix. `raw` is the uncommitted tail only.
 */
export function stripKnownModelScratchpadBlocksPreservingCodeFencesStepped(
  raw: string,
  options?: { initialMaskState?: IndentedMaskState }
): string {
  const initialContainerPrefix = options?.initialMaskState
    ? fenceContainerPrefixFromState(options.initialMaskState)
    : undefined
  const { text: fenceMasked, fences, placeholderBase: fenceBase } = maskCodeFences(raw, { initialContainerPrefix })
  const {
    text: indentedMasked,
    blocks,
    placeholderBase: indentedBase
  } = maskIndentedCodeBlocksStepped(fenceMasked, { initialState: options?.initialMaskState })
  const { text: inlineMasked, spans, placeholderBase: inlineBase } = maskInlineCodeSpans(indentedMasked)
  const stripped = stripKnownModelScratchpadBlocks(inlineMasked)
  const withInline = unmaskInlineCodeSpans(stripped, spans, inlineBase)
  const withIndented = unmaskIndentedCodeBlocks(withInline, blocks, indentedBase)
  return unmaskCodeFences(withIndented, fences, fenceBase)
}

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
  let inMarkup: ((index: number) => boolean) | undefined
  let spanCursor = afterOpen
  const collectSpansUntil = (limit: number): void => {
    let pos = spanCursor
    let cachedBlockEnd = -1
    while (pos < limit) {
      const tick = text.indexOf('`', pos)
      if (tick === -1 || tick >= limit) break
      if (isBackslashEscaped(text, tick) || (inMarkup ??= htmlOpeningTagLookup(text))(tick)) {
        pos = tick + 1
        continue
      }
      let run = 0
      while (tick + run < text.length && text[tick + run] === '`') run++
      let j = tick + run
      let closedAt = -1
      // Inline code cannot cross a Markdown block boundary: an unmatched
      // private backtick must not pair with public text past a blank line,
      // or the span swallows the block's real closing tag and the strip
      // deletes the public continuation (cherry-pr-review
      // inv_4f2b0c2d3f9c4a0b).
      const blockEnd = j < cachedBlockEnd ? cachedBlockEnd : (cachedBlockEnd = inlineBlockEnd(text, j))
      // A complete span may hold literal wrapper markup (opener, then the
      // block's own closing tag, then the pair backtick): it is legitimate
      // inline code (cherry-pr-review round-7 inline-wrapper-boundary). But
      // an opener that scans PAST its block's closing tag and only then
      // meets another wrapper's opener is unmatched: pairing it would skip
      // the block's real boundary and either delete the public continuation
      // (round-6 public-summary-boundary) or retain the private suffix.
      let passedBlockCloser = false
      while (j < blockEnd) {
        if (text[j] === '<') {
          if (text.startsWith('</', j)) {
            const closeMatch = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(text.slice(j))
            if (closeMatch && closeMatch[1].toLowerCase() === lowerTagName) passedBlockCloser = true
            j++
            continue
          }
          const wrapperOpen = parseOpeningTagAt(text, j)
          if (
            passedBlockCloser &&
            wrapperOpen &&
            (isModelScratchpadTagName(wrapperOpen.tagName) || wrapperOpen.tagName.toLowerCase() === 'summary')
          )
            break
          j++
          continue
        }
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
        if (!isTargetTag) {
          const textElementEnd = htmlTextElementEnd(text, parsed, lt)
          // An unmatched text-element opener inside scratchpad content must
          // not hide the enclosing block's boundary: skip the literal body
          // only when its matching close exists (cherry-pr-review round-9
          // html-opener-hides-scratchpad-close).
          if (textElementEnd !== null && textElementEnd < text.length) {
            scanPos = textElementEnd
            continue
          }
        }
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
      if (parsed) {
        const textElementEnd = htmlTextElementEnd(out, parsed, openIndex)
        if (textElementEnd !== null) {
          searchFrom = textElementEnd
          continue
        }
      }
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
  // Quote-aware opener scan: a `>` inside a quoted attribute value does not
  // end the tag (cherry-pr-review: quoted-summary-opener).
  const parsed = parseOpeningTagAt(trimmed, 0)
  if (!parsed || parsed.tagName.toLowerCase() !== 'summary' || parsed.isSelfClosing) {
    return null
  }

  const closing = /<\/summary\s*>$/i.exec(trimmed)
  if (!closing || closing.index === undefined || closing.index < parsed.opener.length) {
    return null
  }

  return trimmed.slice(parsed.opener.length, closing.index)
}

export function stripModelScratchpadBlocks(raw: string): string {
  const { text: fenceMasked, fences, placeholderBase: fenceBase } = maskCodeFences(raw)
  const { text: indentedMasked, blocks, placeholderBase: indentedBase } = maskIndentedCodeBlocks(fenceMasked)
  const { text: inlineMasked, spans, placeholderBase: inlineBase } = maskInlineCodeSpans(indentedMasked)
  let out = stripKnownModelScratchpadBlocks(inlineMasked)

  // A complete summary is usable even if the model forgot the leading
  // scratchpad's closing tag. Code/attribute literals are already masked.
  if (/^\s*<(?:analysis|assessment|thinking)\b/i.test(out)) {
    const closing = /<\/summary\s*>\s*$/i.exec(out)
    if (closing && closing.index !== undefined) {
      // Context-aware opener scan: candidates inside comments, CDATA,
      // quoted attribute values, or another tag's extent are literals, not
      // boundaries (cherry-pr-review round-7 opaque-summary-recovery);
      // a quoted `>` must not truncate the opener (cherry-pr-review:
      // quoted-summary-opener).
      let scan = 0
      while (scan < closing.index) {
        const lt = out.indexOf('<', scan)
        if (lt === -1 || lt >= closing.index) break
        if (isBackslashEscaped(out, lt)) {
          scan = lt + 1
          continue
        }
        const opaqueEnd = opaqueMarkupEnd(out, lt)
        if (opaqueEnd !== null) {
          scan = opaqueEnd
          continue
        }
        const parsed = parseOpeningTagAt(out, lt)
        if (parsed) {
          if (
            parsed.tagName.toLowerCase() === 'summary' &&
            !parsed.isSelfClosing &&
            lt + parsed.opener.length <= closing.index
          ) {
            out = out.slice(lt + parsed.opener.length, closing.index)
            break
          }
          scan = lt + parsed.opener.length
          continue
        }
        scan = lt + 1
      }
    }
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

/** Anchored tag body of TRAILING_TOOL_PROTOCOL_CLOSE_RE, for a linearly located suffix candidate. */
const TRAILING_TOOL_PROTOCOL_CLOSE_TAG_RE =
  /^<\/(?:(?:\uFF5C\uFF5C|\|\|)DSML(?:\uFF5C\uFF5C|\|\|)\s*)?(?:parameter|invoke|tool_calls|tool_result)(?=[\s/>])[^>]*>$/iu

/**
 * Linear check for a strippable trailing closing fragment. Testing the full
 * suffix regex against the accumulator backtracks quadratically over a long
 * whitespace-only tail, and this guard runs on every streamed delta
 * (cherry-pr-review). The tag body is `[^>]*`, so any match ends at the last
 * non-whitespace character (a `>`) and starts at the final `<` that does not
 * cross another `>`: locate that single candidate directly.
 */
function hasTrailingToolProtocolClosingFragment(raw: string): boolean {
  let end = raw.length
  while (end > 0 && /\s/u.test(raw[end - 1])) end--
  if (end === 0 || raw[end - 1] !== '>') return false
  const open = raw.lastIndexOf('<', end - 2)
  if (open === -1 || raw.indexOf('>', open) !== end - 1) return false
  return TRAILING_TOOL_PROTOCOL_CLOSE_TAG_RE.test(raw.slice(open, end))
}

/** Strips a trailing run of tool-protocol closing tags; does not touch tags in fences or inline code. */
export function stripTrailingToolProtocolClosingFragments(raw: string): string {
  // No suffix candidate means masking cannot remove anything. Avoid rescanning
  // the entire streamed accumulator for ordinary prose and fenced snippets.
  if (!raw || !hasTrailingToolProtocolClosingFragment(raw)) return raw
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
    // Only unmatched protocol closers are debris. Balanced elements in ordinary
    // answer prose are literal markup, not evidence of a tool call.
    const name = /^<\/([^\s/>]+)/u.exec(out.slice(tagIndex))?.[1].toLowerCase()
    if (!name) break
    let balance = 0
    // Comment- and quote-aware balance scan: a closer inside an HTML
    // comment or a quoted attribute value is literal text, not real
    // markup - counting it makes the actual closing tag look like
    // unmatched debris and deletes it from balanced literal markup
    // (cherry-pr-review inv_4f2b0c2d3f9c4a0b).
    const prefix = out.slice(0, tagIndex)
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const sameTagClose = new RegExp(`^</${escapedName}(?=[\\s/>])`, 'iu')
    const sameTagOpen = new RegExp(`^<${escapedName}(?=[\\s/>])`, 'iu')
    // Quote-aware skip from just after `<name` to one past the tag's `>`.
    const skipTagTail = (from: number): number => {
      let i = from
      while (i < prefix.length) {
        const ch = prefix[i]
        if (ch === '>') return i + 1
        if (ch === '"' || ch === "'") {
          i++
          while (i < prefix.length && prefix[i] !== ch) i++
        }
        i++
      }
      return prefix.length
    }
    let scan = 0
    while (scan < prefix.length) {
      const lt = prefix.indexOf('<', scan)
      if (lt === -1) break
      if (isBackslashEscaped(prefix, lt)) {
        scan = lt + 1
        continue
      }
      const opaqueEnd = opaqueMarkupEnd(prefix, lt)
      if (opaqueEnd !== null) {
        scan = opaqueEnd
        continue
      }
      const rest = prefix.slice(lt)
      const closeMatch = sameTagClose.exec(rest)
      if (closeMatch) {
        const end = skipTagTail(lt + closeMatch[0].length)
        if (prefix[end - 1] === '>') balance = Math.max(0, balance - 1)
        scan = end
        continue
      }
      const openMatch = sameTagOpen.exec(rest)
      if (openMatch) {
        const end = skipTagTail(lt + openMatch[0].length)
        if (prefix[end - 1] === '>' && !/\/\s*>$/.test(prefix.slice(lt, end))) balance += 1
        scan = end
        continue
      }
      // Some other tag: skip it quote-aware so its attributes stay opaque.
      const parsed = parseOpeningTagAt(prefix, lt)
      scan = parsed ? lt + parsed.opener.length : lt + 1
    }
    if (balance > 0) break
    out = out.slice(0, trailing.index)
  }
  out = unmaskInlineCodeSpans(out, spans, inlineBase)
  out = unmaskIndentedCodeBlocks(out, blocks, indentedBase)
  return unmaskCodeFences(out, fences, fenceBase)
}
