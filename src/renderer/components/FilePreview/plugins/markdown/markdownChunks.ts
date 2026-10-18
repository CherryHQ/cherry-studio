/**
 * Markdown source splitting for the windowed preview.
 *
 * Each chunk renders as its own Markdown document, so a boundary may only fall on a blank line
 * where every spanning construct is closed — fenced code, display math, raw HTML, indented code —
 * and outside every list: a list split apart renumbers its ordered items and turns loose items
 * tight, because a one-item list parses differently from the list it was cut out of.
 *
 * Reference definitions belong to the document rather than to a chunk: a link used in one chunk may
 * be defined in another, and a reference whose definition is missing degrades to literal text. Every
 * definition is therefore carried into every chunk, where an unused one renders nothing.
 */

import { decodeNamedCharacterReference } from 'decode-named-character-reference'
import { decodeNumericCharacterReference } from 'micromark-util-decode-numeric-character-reference'

import { normalizeHeadingText } from '@cherrystudio/ui'

import { isPathologicalLineShape } from '../../textPreviewGuard'

export interface MarkdownChunk {
  /** Markdown source for this chunk, including the carried reference definitions. */
  text: string
  /** Source line count, used to estimate the rendered height before it is measured. */
  lines: number
  /**
   * Document-wide heading slugs for this chunk's headings, keyed by normalized heading text and
   * listed in document order. Each chunk renders as its own document, so without these a duplicate
   * heading in another chunk would collide on the slug the unsplit document numbers `-1`.
   */
  headingSlugs?: ReadonlyMap<string, readonly string[]>
}

/**
 * Per-chunk budget. Small enough that mounting a chunk is one responsive frame, large enough that
 * a typical document stays a handful of chunks.
 */
export const MARKDOWN_CHUNK_BUDGET_CHARS = 24 * 1024

/**
 * A single indivisible block cannot be windowed, so one this large would still reach the renderer
 * whole. That is pathological input rather than a merely long document, and it falls back to the
 * virtualized plain-text viewer.
 */
export const MARKDOWN_MAX_BLOCK_CHARS = 512 * 1024

interface Fence {
  marker: string
  length: number
}

function parseFence(line: string): Fence | null {
  const match = /^[ \t]*(`{3,}|~{3,})/.exec(line)
  // Indent is counted in columns, so a tab — which spans to the next multiple of four — leaves
  // the run past the three a fence may sit at and the parser reads the line as indented code.
  if (!match || leadingColumns(line) > 3) return null
  const run = match[1]
  // An opening backtick fence cannot carry a backtick in its info string.
  if (run[0] === '`' && line.slice(match[0].length).includes('`')) return null
  return { marker: run[0], length: run.length }
}

/** A list item marker a fence may sit behind — `- ` ``` `` opens a fence inside the item. */
const LIST_MARKER_PREFIX = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$)/

function isClosingFence(line: string, fence: Fence): boolean {
  const match = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line)
  return !!match && leadingColumns(line) <= 3 && match[1][0] === fence.marker && match[1].length >= fence.length
}

/** A fenced code block open behind the container its opening line was written behind. */
interface ContainerFence {
  fence: Fence
  /**
   * How many block quote markers each of its lines has to reproduce — every marker in the chain,
   * whether it sits outside a list item or inside one: a continuation line carries them all.
   */
  quotes: number
  /**
   * The column the item's content starts at when a list marker holds the fence. Its lines are code
   * the item owns, so one that falls short of the column has left the item and ends the fence with
   * it; quotes alone hold their content wherever their markers leave it, so they set no column.
   */
  contentColumn: number
}

/**
 * A fenced code block opened behind a container — block quote markers, a list item's marker, or any
 * nesting of the two — or null. The fence belongs to the block those markers open, so every line
 * that reproduces them is its code and a definition-shaped line among them is one the parser never
 * reads.
 *
 * The chain is walked in the order it was written, because that is the order the parser opens the
 * blocks in: `- > ``` ` is an item holding a quote, and `> - ``` ` a quote holding an item, and the
 * two hold their content at different columns. The last item in the chain sets the content column,
 * and every quote marker in the chain has to be reproduced, because a continuation line carries them
 * all. A list marker indented four columns is indented code, and five columns of whitespace behind a
 * marker leave what follows in code the item never sees, so no fence opens behind either.
 */
function openContainerFence(line: string): ContainerFence | null {
  if (leadingColumns(line) >= 4) return null
  let content = line
  let quotes = 0
  let contentColumn = -1
  // The chain is finite: each step consumes at least one marker character, so the walk terminates.
  for (;;) {
    const quote = QUOTE_MARKER.exec(content)
    const item = quote ? null : LIST_MARKER_PREFIX.exec(content)
    if (quote) {
      content = content.slice(quote[0].length)
      quotes += 1
      continue
    }
    if (!item) break
    // The marker's separator is the whitespace run that follows it, and its columns set the item's
    // content column — the fence sits at it. Counted on the line itself: a tab advances to the next
    // multiple of four wherever it falls, so the markers in front of the marker count too.
    const separator = /^[ \t]*/.exec(content.slice(item[0].length))?.[0] ?? ''
    const markerColumns = columnCount(line.slice(0, line.length - content.length + item[0].length))
    contentColumn = columnCount(line.slice(0, line.length - content.length + item[0].length + separator.length))
    if (contentColumn - markerColumns >= 5) return null
    content = content.slice(item[0].length + separator.length)
  }
  const fence = parseFence(content)
  return fence ? { fence, quotes, contentColumn } : null
}

/**
 * The raw-HTML blocks a blank line does not close (CommonMark types 1–5); the remaining types end at
 * a blank line, which is already a boundary.
 */
function htmlBlockTerminator(line: string): RegExp | null {
  // The raw names take only a pure open tag — `<pre/>` is a type-7 tag the parser does not read
  // as raw, so it must not open a region that swallows the lines below it.
  const raw = /^ {0,3}<(pre|script|style|textarea)(?=[ \t>]|$)/i.exec(line)
  if (raw) return new RegExp(`</${raw[1]}\\s*>`, 'i')
  if (/^ {0,3}<!--/.test(line)) return /-->/
  if (/^ {0,3}<\?/.test(line)) return /\?>/
  if (/^ {0,3}<!\[CDATA\[/.test(line)) return /\]\]>/
  if (/^ {0,3}<![A-Za-z]/.test(line)) return />/
  return null
}

/**
 * A footnote definition, which owns its indented lines. The label takes no whitespace — GFM reads
 * `[^see below]:` as the paragraph it looks like — and no bracket, escaped or not. Indent is
 * counted in columns: a tab spans four of them, so a tab-indented label sits in indented code
 * where no definition opens.
 */
const FOOTNOTE_DEFINITION_START = /^ {0,3}\[\^[^\][\s]+]:(.*)$/

/**
 * An ATX heading: up to three columns of indent, one to six `#`, then the heading's text — which
 * may be empty, the bare `#` the parser still reads as a heading.
 */
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]+(.*?)[ \t]*#*)?[ \t]*$/

/**
 * The container markers a definition may sit behind — block quotes, list items, and any nesting of
 * the two. A definition belongs to the document rather than to the block that happens to hold it,
 * so the parser accepts one behind a quote or a list item and registers it for the whole document.
 * The markers repeat, because a quote may hold a list item that holds the definition.
 */
const DEFINITION_CONTAINER = /^(?:(?:[ \t]*>)+[ \t]*|(?:[ \t]*[-+*]|[ \t]*\d{1,9}[.)])[ \t]+)+/

/**
 * A block quote marker. Each marker of a nesting must sit within three columns of the one it
 * follows — deeper, the line is the content of a code block rather than a deeper quote.
 */
const QUOTE_MARKER = /^ {0,3}>[ \t]?/

/** The line past its block quote markers, and how many it carried. */
function pastQuoteMarkers(line: string): { content: string; quotes: number } {
  let content = line
  let quotes = 0
  for (let marker = QUOTE_MARKER.exec(content); marker; marker = QUOTE_MARKER.exec(content)) {
    content = content.slice(marker[0].length)
    quotes += 1
  }
  return { content, quotes }
}

/** The line past its first `count` block quote markers, or null when it carries fewer than that. */
function afterQuoteMarkers(line: string, count: number): string | null {
  let content = line
  for (let quote = 0; quote < count; quote += 1) {
    const marker = QUOTE_MARKER.exec(content)
    if (!marker) return null
    content = content.slice(marker[0].length)
  }
  return content
}

/** A line opening a block quote: a marker at three columns or less, at any depth of nesting. */
const QUOTE_START = /^ {0,3}>/

/** The block quote markers in a container prefix — how deeply a definition is quoted. */
function quoteDepth(container: string): number {
  return container.match(/[ \t]*>[ \t]?/g)?.length ?? 0
}

/** The column a prefix ends at — a tab advances to the next multiple of four, as the parser counts. */
function columnCount(prefix: string): number {
  let columns = 0
  for (const character of prefix) {
    columns = character === '\t' ? columns + (4 - (columns % 4)) : columns + 1
  }
  return columns
}

/**
 * The floor each block quote in a definition's container sets for a continuation line's matching
 * marker: its own column when a list item holds it — a shallower marker falls out of the item and
 * opens a block of its own, ending the definition — and none for a quote nested in quotes alone,
 * which continues at any legal depth. Legality there is the marker chain itself: each marker sits
 * within three columns of the one it follows, which the marker-by-marker match already enforces.
 */
function quoteMarkerColumns(container: string): number[] {
  const floors: number[] = []
  let heldByItem = false
  let column = 0
  for (const character of container) {
    if (character === '>') {
      floors.push(heldByItem ? column : -1)
      heldByItem = false
    } else if (character !== ' ' && character !== '\t') {
      heldByItem = true
    }
    column = character === '\t' ? column + (4 - (column % 4)) : column + 1
  }
  return floors
}

/** How the parser continues a definition's lines behind the container it was written in. */
interface DefinitionContainer {
  /** How many block quote markers the definition sits behind. */
  quotes: number
  /** The column floor each of those markers has to sit at or beyond. */
  quoteColumns: number[]
  /**
   * The column the definition's own content starts at when a list item holds it — quotes alone
   * hold their content wherever the marker chain leaves it. Counted in columns: a tab inside a
   * marker advances to the next stop, so `-\t` spans four of them.
   */
  labelColumn: number
}

function containerParams(prefix: string): DefinitionContainer {
  return {
    quotes: quoteDepth(prefix),
    quoteColumns: quoteMarkerColumns(prefix),
    labelColumn: /(?:[-+*]|\d{1,9}[.)])[ \t]+$/.test(prefix) ? columnCount(prefix) : -1
  }
}

/**
 * Take a definition continuation line past the container its opening line was written behind,
 * returning the content the parser reads there — or null when the line does not reproduce the
 * container and so leaves the definition's block. Block quote markers strip off one per level
 * while a list item's marker is content-prefixed rather than reproduced: its continuation lines
 * are indented to the item's content column, so that much whitespace comes away with it.
 */
function stripDefinitionContainer(line: string, container: DefinitionContainer): string | null {
  let content = line
  for (let quote = 0; quote < container.quotes; quote += 1) {
    const marker = QUOTE_MARKER.exec(content)
    if (!marker) return null
    content = content.slice(marker[0].length)
  }
  if (container.labelColumn < 0) return content
  // An item's content column is measured past its marker; a line that carries the quote markers
  // but not the item's indentation has left the item. The content's column is counted on the line
  // itself, quote markers included: a tab advances to the next multiple of four wherever it falls.
  const columns = content.match(/^[ \t]*/)?.[0] ?? ''
  const contentStart = line.length - content.length + columns.length
  return columnCount(line.slice(0, contentStart)) >= container.labelColumn ? content : null
}

/** The next content line read from inside the open definition's container, or undefined. */
function strippedNextContent(
  lines: string[],
  nextContent: number[],
  index: number,
  container: DefinitionContainer
): string | undefined {
  const next = nextContent[index]
  if (next < 0) return undefined
  const stripped = stripDefinitionContainer(lines[next], container)
  return stripped ?? undefined
}

/**
 * Whether a whitespace run inside a container prefix leaves what follows it in indented code. The
 * parser reads a marker plus up to four columns of separator as that marker and the content it
 * holds; a fifth column — between two markers, or between the last marker and the label — makes
 * whatever follows code the container never sees, so no definition opens behind the prefix.
 */
function containerWhitespaceOpensCode(container: string): boolean {
  let column = 0
  let seenMarker = false
  let run = 0
  for (const character of container) {
    const width = character === '\t' ? 4 - (column % 4) : 1
    column += width
    if (character === ' ' || character === '\t') {
      if (seenMarker) run += width
    } else {
      if (seenMarker && run >= 5) return true
      run = 0
      seenMarker = true
    }
  }
  // A list marker's separator is mandatory, so the prefix ends on the run the label follows.
  return seenMarker && run >= 5
}

/**
 * A link reference definition label, which may leave its destination to a line of its own — and
 * may itself wrap onto the lines below, which `wrappedLinkLabel` reads. A label may hold an
 * escaped bracket (`[a\]b]`), so brackets only end the label when unescaped — and never an
 * unescaped opening one, which the parser reads as nesting the label cannot close. The colon has
 * to sit directly behind the closing bracket — `[label] : /url` is the prose it looks like —
 * while what it leaves behind is the whitespace that may lead the destination.
 */
const LINK_DEFINITION_LABEL = /^\[(?!\^)((?:\\.|[^\]\\[])+)\]:([ \t]*)([\s\S]*)$/

/**
 * The longest link label the parser accepts: 999 characters, counted in the source the label was
 * written in — an escape is two of them and the brackets are not part of the count at all. A longer
 * run is no label, so the line is paragraph text the document renders once.
 */
const MAX_LABEL_SOURCE_CHARS = 999

/**
 * A link destination: an angle-bracketed run or a whitespace-free one, behind any indentation. A
 * bare destination may not start with `<` — that form belongs to the angle brackets — and its
 * parentheses have to balance, which `balancedParens` checks where the destination is accepted.
 */
const LINK_DESTINATION = /^[ \t]*(?:<[^<>]*>|(?!<)\S+)/

/** A link title, which may sit on the line below the destination; its delimiter may be escaped. */
const LINK_TITLE = /^[ \t]*(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\((?:\\.|[^)\\\n])*\))[ \t]*$/

/**
 * A title the parser has accepted the opening of but not yet closed: the title runs on to the lines
 * below the one it opens on, and only the closing delimiter ends it.
 */
const LINK_TITLE_OPEN = /^[ \t]*(?:"(?:\\.|[^"\\\n])*|'(?:\\.|[^'\\\n])*|\((?:\\.|[^)\\\n])*)$/

/** The delimiter a title opened with, as the one that has to close it. */
function titleClosingDelimiter(text: string): string {
  const opening = /^[ \t]*("|'|\()/.exec(text)
  return opening ? (opening[1] === '(' ? ')' : opening[1]) : ''
}

/**
 * How a line below leaves a title that is still open. The title's content admits no unescaped
 * closing delimiter, so the first one on a line ends the title when only whitespace follows it and
 * can never be recovered from otherwise. A backslash escapes the character after it, and one at a
 * line's end escapes the space that joins the lines, so every line starts unescaped.
 */
function scanTitleContinuation(line: string, close: string): 'closed' | 'open' | 'dead' {
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '\\') {
      index += 1
    } else if (character === close) {
      return /^[ \t]*$/.test(line.slice(index + 1)) ? 'closed' : 'dead'
    }
  }
  return 'open'
}

/** Whether a bare destination's unescaped parentheses balance, as the parser requires of one. */
function balancedParens(text: string): boolean {
  let depth = 0
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\') {
      index += 1
    } else if (character === '(') {
      depth += 1
    } else if (character === ')' && (depth -= 1) < 0) {
      return false
    }
  }
  return depth === 0
}

/**
 * The line past a destination that opens at its start, or null when none does: the run the
 * destination regex accepts has to be one the parser accepts too, or the line is not a
 * definition's destination at all.
 */
function pastDestination(line: string): string | null {
  const match = LINK_DESTINATION.exec(line)
  if (!match) return null
  const destination = match[0].trimStart()
  if (!destination.startsWith('<') && !balancedParens(destination)) return null
  return line.slice(match[0].length)
}

const INDENTED_LINE = /^\s+\S/

/**
 * A fenced, heading or ruled block that ends an open definition where it appears, so a title that
 * never closes cannot swallow it. The three-column allowance is load-bearing: such a line indented
 * four or more is content of the definition rather than a block of its own, and a tab is four
 * columns, so neither ends it. A backtick fence's info string may not hold a backtick, so `` ```x`y ``
 * opens no fence — the parser reads it as prose.
 */
const BLOCK_START =
  /^ {0,3}(?:`{3,}[^`]*$|~{3,}|#{1,6}(?:[ \t]|$)|(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$)/

/** CommonMark's type-6 block-level tag names; a tag outside the two sets opens no block. */
const HTML_BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'base',
  'basefont',
  'blockquote',
  'body',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'iframe',
  'legend',
  'li',
  'link',
  'main',
  'menu',
  'menuitem',
  'nav',
  'noframes',
  'ol',
  'optgroup',
  'option',
  'p',
  'param',
  'search',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul'
])

/**
 * CommonMark's raw-text tags (type 1), which open a block only in their plain opening form — the
 * parser reads `</pre>` and `<pre/>` as type 7, which cannot interrupt.
 */
const HTML_RAW_TAGS = new Set(['pre', 'script', 'style', 'textarea'])

/** The tags that take no closing one, so an opening tag of theirs holds no element open. */
const VOID_HTML_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
])

interface HtmlTag {
  name: string
  closing: boolean
  selfClosing: boolean
}

/**
 * Walk the tags a line carries, one character run at a time. A tag opens at `<` plus a name, ends
 * at the first `>` that is not inside matched quotes, and an unterminated one is dropped — which is
 * what keeps a line of stray quotes linear instead of exponential.
 */
function* eachHtmlTag(line: string): Generator<HtmlTag> {
  let index = 0
  while (index < line.length) {
    const at = line.indexOf('<', index)
    if (at < 0) return
    const named = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(line.slice(at))
    if (!named) {
      index = at + 1
      continue
    }
    const attrsStart = at + named[0].length
    let cursor = attrsStart
    let terminated = false
    while (cursor < line.length) {
      const char = line[cursor]
      if (char === '>') {
        terminated = true
        break
      }
      // A quoted run is opaque: a `>` inside it does not end the tag, and an unterminated quote
      // runs to the end of the line rather than backtracking into the alternatives behind it.
      if (char === '"' || char === "'") {
        const end = line.indexOf(char, cursor + 1)
        if (end < 0) {
          // An unterminated quote holds no run: the rest of the tag is plain characters, and it
          // ends at the next `>` — or the tag is dropped, which is what keeps a line of stray
          // quotes linear instead of exponential.
          const close = line.indexOf('>', cursor + 1)
          if (close < 0) return
          cursor = close
          terminated = true
          break
        }
        cursor = end + 1
        continue
      }
      cursor += 1
    }
    if (terminated) {
      yield {
        name: named[2].toLowerCase(),
        closing: named[1] === '/',
        selfClosing: /\/\s*$/.test(line.slice(attrsStart, cursor))
      }
    }
    index = terminated ? cursor + 1 : at + 1
  }
}

/**
 * Fold one line's tags into the stack of elements the renderer reads as open after it. A closing
 * tag ends the nearest element of its own name — with the ones opened inside it, the way a
 * renderer recovers from the nesting it was written with — and an opening one holds an element
 * open unless it is void, or the self-closing slash closes it: the parser drops that slash on an
 * HTML element (`<details/>` opens the disclosure) and honors it only in foreign content. Only
 * the tags an HTML block exposes are read here, which is where the renderer's elements are
 * written whole.
 */
function trackHtmlElements(line: string, open: string[]): void {
  // Scanned by hand, not by a regex: the tag's attributes alternate between quoted runs and
  // `[^>]`, and a tag that never closes makes those alternatives overlap — the backtracking an
  // engine spends on it grows exponentially in the number of quotes, which stalls the splitter
  // before the fallback has a chance to guard it. Each step here advances over one quote run or
  // one plain character, so a whole line costs one pass over it.
  for (const tag of eachHtmlTag(line)) {
    if (tag.closing) {
      const at = open.lastIndexOf(tag.name)
      if (at >= 0) open.length = at
      continue
    }
    const foreign = tag.name === 'svg' || tag.name === 'math' || open.includes('svg') || open.includes('math')
    // A raw name keeps the region contract its own tag shape sets: `<pre/>` is the type-7 tag the
    // parser reads plain, and holding an element open there would swallow the lines below it.
    const opens = tag.selfClosing ? !foreign && !HTML_RAW_TAGS.has(tag.name) : !VOID_HTML_ELEMENTS.has(tag.name)
    if (opens) open.push(tag.name)
  }
}

/**
 * The line with its HTML comments taken out, across lines: the tags a comment carries are its own,
 * and one read as an element would hold the stack open for the rest of the block. `inComment.open`
 * carries the state across the lines of one block, from the `<!--` that opens a comment to the
 * `-->` that closes it.
 */
function withoutHtmlComments(line: string, inComment: { open: boolean }): string {
  let kept = ''
  let index = 0
  while (index < line.length) {
    if (inComment.open) {
      const end = line.indexOf('-->', index)
      if (end < 0) return kept
      inComment.open = false
      index = end + 3
      continue
    }
    const start = line.indexOf('<!--', index)
    if (start < 0) return kept + line.slice(index)
    kept += line.slice(index, start)
    inComment.open = true
    index = start + 4
  }
  return kept
}

/**
 * A line opening an HTML block the parser takes even inside the construct it is reading: a comment,
 * a processing instruction, a declaration, a CDATA section, or a block-level tag. Any other tag is
 * type 7, which cannot interrupt, so a bare `<a>` inside a link title stays title text — as does an
 * autolink. A type-7 tag with a double-quoted attribute also ends the definition in this position,
 * but the span measurement reaches that verdict on its own, so the predicate need not encode it.
 */
function opensHtmlBlock(line: string): boolean {
  if (/^ {0,3}<(?:!--|\?|!\[CDATA\[|![A-Za-z])/.test(line)) return true
  // The name has to end at whitespace, `>`, `/>` or the line's end — the parser reads `<div"x>` as
  // a paragraph continuation, not a block, so accepting any suffix here would end the definition
  // the title runs on.
  const tag = /^ {0,3}<(\/?)([A-Za-z][A-Za-z0-9-]*)([ \t/>]|$)/.exec(line)
  if (!tag) return false
  const name = tag[2].toLowerCase()
  if (HTML_RAW_TAGS.has(name)) return tag[1] === '' && tag[3] !== '/'
  // A slash ends the name only once its `>` follows, so `<div/ >` is prose the same way — the
  // parser takes a type-6 name as closed just by the complete `/>`.
  if (tag[3] === '/' && line[tag[0].length] !== '>') return false
  return HTML_BLOCK_TAGS.has(name)
}

/**
 * A list marker indented at most three columns — the deepest a marker may sit and still open the
 * list where it stands. Four or more columns is code at the document level and, inside a
 * footnote definition, content the footnote owns, so it interrupts nothing.
 */
const INTERRUPTING_LIST_MARKER = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/

/** A marker with nothing after it: an empty item, which opens a list only outside paragraphs. */
const EMPTY_LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]*$/

/**
 * A marker that ends a paragraph where it appears: a bullet in any form, an ordered one only
 * numbered `1`. Any other number cannot interrupt a paragraph, so on a definition's open title it
 * is title text rather than the list that would end the definition — and an empty item cannot
 * interrupt either, so only a marker with content after it counts.
 */
const PARAGRAPH_INTERRUPTING_LIST_MARKER = /^ {0,3}(?:[-+*]|1[.)])[ \t]+\S/

/**
 * A setext heading underline: `=+` for h1, `-+` for h2. A dash run of any length underlines where
 * a paragraph is open — CommonMark reads a setext underline ahead of the thematic break the same
 * run would be — so the length that decides is the marker, not the count: three or more `*`, `_`
 * or spaces-interrupted dashes is a break, which THEMATIC_BREAK and BLOCK_START already hold.
 * Deeper than three columns it is indented code, which interrupts nothing.
 */
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/

/**
 * Whether the container on a definition-shaped line opens a block the paragraph above it does not
 * continue — a deeper quote, or a list marker, which opens a fresh item even at the same depth. A
 * marker that merely repeats the one the paragraph already sits behind does not: `> paragraph`
 * followed by `> [label]: /wrong` is one quoted paragraph, so the definition shape in it is prose.
 */
function containerOpensBlock(container: string, previous: string): boolean {
  const quotes = quoteDepth(container)
  if (quotes !== quoteDepth(previous)) return quotes > quoteDepth(previous)
  return /(?:[-+*]|\d{1,9}[.)])[ \t]+$/.test(container)
}

/**
 * Whether `line` is a setext underline — including one behind block quote markers, where the
 * parser reads it inside the quote rather than at the top level.
 */
function isSetextUnderline(line: string): boolean {
  return SETEXT_UNDERLINE.test(line) || SETEXT_UNDERLINE.test(pastQuoteMarkers(line).content)
}

/**
 * Whether a line that opens no definition is complete where it stands, so the line below starts a
 * new block rather than continuing a paragraph: an ATX heading, the underline that makes the line
 * above a setext heading, or a thematic break.
 */
function isCompletedBlock(line: string, container: string | null): boolean {
  const content = container === null ? line : line.slice(container.length)
  return ATX_HEADING.test(content) || isSetextUnderline(line) || THEMATIC_BREAK.test(line)
}

/**
 * Whether a line opens a block that ends a footnote definition where it appears: a marker at
 * three columns or less closes it, because the footnote holds its continuation lines only at
 * four columns of indent. An empty list item closes it too — the footnote's own continuation
 * check has no interrupt rule, so even an item with no content opens a list — but a setext
 * underline does not: it cannot pair with a paragraph held by another container, so it stays
 * footnote prose.
 */
function startsBlock(line: string): boolean {
  return (
    QUOTE_START.test(line) ||
    INTERRUPTING_LIST_MARKER.test(line) ||
    EMPTY_LIST_ITEM.test(line) ||
    BLOCK_START.test(line) ||
    opensHtmlBlock(line)
  )
}

/**
 * Whether a line opens a block that ends a paragraph where it appears. A definition's open title
 * reads the lines below it the way a paragraph does, so the interrupt rule for its markers is the
 * parser's: only `1.` or `1)` takes the line, and a marker deeper than three columns is code. A
 * quote marker and a setext underline end the paragraph as well — the title sits in the document,
 * so both pair with it.
 */
function interruptsParagraph(line: string): boolean {
  return (
    QUOTE_START.test(line) ||
    PARAGRAPH_INTERRUPTING_LIST_MARKER.test(line) ||
    SETEXT_UNDERLINE.test(line) ||
    BLOCK_START.test(line) ||
    opensHtmlBlock(line)
  )
}

/**
 * A complete tag alone on its line — the one tag form a lazy line takes. The parser holds an
 * unfinished tag (`<a`, at the line's end) and a tag with content after it (`<a> x`) to the
 * paragraph it continues. An attribute name also has to start the way the tokenizer reads one —
 * a letter, `_` or `:`, never a digit or a dot — and a closing tag takes neither attributes nor
 * a self-closing slash, so `<a 1>`, `<a b!>` and `</a x>` are prose too. Types 1–6 are
 * startsBlock's business; this is the type-7 shape.
 */
const COMPLETE_TAG_LINE =
  /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*[ \t]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>)[ \t]*$/

/**
 * Whether a line opens a block that ends a paragraph it continues lazily — one that fell short of
 * the container holding the paragraph, so the parser checks none of its interrupt rules: any list
 * marker, an empty item and any ordered number included, and a complete tag on a line of its own
 * open a block there. A setext underline is the one construct barred from a lazy line outright, so
 * it stays paragraph text.
 */
function endsLazyParagraph(line: string): boolean {
  return startsBlock(line) || COMPLETE_TAG_LINE.test(line)
}

/** The columns a line is indented by — a tab advances to the next multiple of four. */
function leadingColumns(line: string): number {
  let columns = 0
  for (const character of line) {
    if (character === ' ') columns += 1
    else if (character === '\t') columns += 4 - (columns % 4)
    else return columns
  }
  return columns
}

/**
 * The line with `columns` of leading whitespace removed — the offset a list item's continuation
 * measures its blocks from, so `    --` inside an item whose content starts at column two is a
 * setext underline. The parser counts columns the way tabs expand, so the whitespace is expanded
 * before anything is removed: a tab that spans past the boundary leaves the columns it overshoots
 * as spaces, and one that starts at the boundary leaves the columns it spans.
 */
function afterColumns(columns: number, line: string): string {
  let expanded = ''
  let seen = 0
  let index = 0
  while (index < line.length && (line[index] === ' ' || line[index] === '\t')) {
    const width = line[index] === ' ' ? 1 : 4 - (seen % 4)
    expanded += ' '.repeat(width)
    seen += width
    index += 1
  }
  return expanded.slice(columns) + line.slice(index)
}

/**
 * How far a bracketed run that opens at `open` reaches before it closes, and whether it closes at
 * all. Brackets nest and a backslash escapes the character after it, so only an unescaped `]` at
 * the run's own depth ends it. Without a closing bracket the scan runs to the end of the source,
 * and every later bracket in the same run repeats it — so `end` is returned either way, letting the
 * caller skip the stretch it already read instead of rescanning it once per character.
 */
function pastBracketRun(source: string, open: number): { end: number; closed: boolean } {
  let depth = 0
  let index = open
  for (; index < source.length; index += 1) {
    const character = source[index]
    if (character === '\\') index += 1
    else if (character === '[') depth += 1
    else if (character === ']' && (depth -= 1) === 0) return { end: index + 1, closed: true }
  }
  return { end: index, closed: false }
}

/** The index past a parenthesised run that opens at `open`, or −1 when it never closes. */
function pastParenRun(source: string, open: number): number {
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    const character = source[index]
    if (character === '\\') index += 1
    else if (character === '(') depth += 1
    else if (character === ')' && (depth -= 1) === 0) return index + 1
  }
  return -1
}

/** A run of emphasis markers — the `*` in `# foo*bar*`, whose open/close class decides the text. */
const EMPHASIS_RUN = /^[*_]+/

/** micromark's punctuation class (`unicodePunctuation`): `\p{P}|\p{S}`. */
const MICROMARK_PUNCTUATION = /\p{P}|\p{S}/u

/** micromark's whitespace class: `markdownLineEndingOrSpace` plus `unicodeWhitespace` (`\s`). */
const MICROMARK_WHITESPACE = /\s/

/**
 * The group a character falls in for micromark's attention tokenizer
 * (`micromark-util-classify-character`): whitespace, punctuation, or neither — `undefined` for an
 * ordinary character, which is what `!after` and `!before` really test. EOF counts as whitespace,
 * so an out-of-range code — start of line, end of line — does here.
 */
function micromarkClass(code: number): 'whitespace' | 'punctuation' | undefined {
  if (Number.isNaN(code)) return 'whitespace'
  const character = String.fromCodePoint(code)
  if (MICROMARK_WHITESPACE.test(character)) return 'whitespace'
  return MICROMARK_PUNCTUATION.test(character) ? 'punctuation' : undefined
}

/**
 * Whether a run of emphasis markers can open a span, and whether it can close one — the two flags
 * `micromark-core-commonmark`'s `tokenizeAttention` computes from the characters beside the run. A
 * run neither flag reaches stays the literal text it was written as (`a*b*c`, `foo_bar_baz`), and
 * `_` that can both open and close is the intraword underscore, which is text too.
 */
function emphasisFlanks(before: number, run: string, after: number): { opens: boolean; closes: boolean } {
  const left = micromarkClass(before)
  const right = micromarkClass(after)
  const open = right === undefined || (right === 'punctuation' && left !== undefined)
  const close = left === undefined || (left === 'punctuation' && right !== undefined)
  // The `!before`/`!after` tests above already cover whitespace, which classifies as its own group
  // here; micromark asks the same question of every non-punctuation neighbour, whitespace included.
  if (run[0] === '*') return { opens: open, closes: close }
  return { opens: open && (left === undefined || !close), closes: close && (right === undefined || !open) }
}

/**
 * The offsets of the emphasis runs in `source` — the `*` of `Foo*bar*` — with the flanks micromark
 * reads from the characters beside each one. The scan is linear in the source: a run is matched
 * where it stands and never revisited.
 */
function emphasisRuns(
  source: string
): Array<{ open: number; end: number; run: string; opens: boolean; closes: boolean }> {
  const runs: Array<{ open: number; end: number; run: string; opens: boolean; closes: boolean }> = []
  for (let index = 0; index < source.length;) {
    const character = source[index]
    if (character === '\\') {
      index += 2
      continue
    }
    if (character !== '*' && character !== '_') {
      index += 1
      continue
    }
    const run = EMPHASIS_RUN.exec(source.slice(index))?.[0] ?? character
    const end = index + run.length
    const { opens, closes } = emphasisFlanks(
      index > 0 ? source.charCodeAt(index - 1) : NaN,
      run,
      source.charCodeAt(end)
    )
    runs.push({ open: index, end, run, opens, closes })
    index = end
  }
  return runs
}

/**
 * The emphasis runs of `source` that the renderer reads as the markers of a span — which render no
 * text of their own. A run is emphasis only once it has a partner: micromark matches each closing
 * run with the nearest opening one of the same marker, so the trailing `*` of `a *b` and the `_` of
 * `foo_bar_baz` never pair and stay the text they were written as.
 */
function emphasisSpans(source: string): Set<number> {
  const runs = emphasisRuns(source)
  const spans = new Set<number>()
  // A stack of runs still looking for a partner: micromark pairs a closing run with the nearest
  // opening one of the same marker, so the top of the stack is the one it takes.
  const open: Array<{ at: number; marker: string }> = []
  for (const current of runs) {
    const top = open[open.length - 1]
    if (current.closes && top?.marker === current.run[0]) {
      spans.add(top.at)
      spans.add(current.open)
      open.pop()
    } else if (current.opens) {
      open.push({ at: current.open, marker: current.run[0] })
    }
  }
  return spans
}

/** A run of tildes — the `~~` of `# foo~~bar~~baz`, whose pairing decides the text it renders. */
const TILDE_RUN = /^~+/

/**
 * The tilde runs of `source` that the renderer reads as the markers of a strikethrough — which
 * render no text of their own. The renderer turns single tildes away, so a run is eligible only
 * at two markers, and it pairs a closing run with the nearest earlier one of its own length by
 * the same flank tests emphasis reads; a run that pairs with nothing stays the text it was
 * written as.
 */
function strikethroughSpans(source: string): Set<number> {
  const spans = new Set<number>()
  const open: number[] = []
  for (let index = 0; index < source.length;) {
    const character = source[index]
    if (character === '\\') {
      index += 2
      continue
    }
    if (character !== '~') {
      index += 1
      continue
    }
    const run = TILDE_RUN.exec(source.slice(index))?.[0] ?? character
    const end = index + run.length
    if (run.length === 2) {
      const left = micromarkClass(index > 0 ? source.charCodeAt(index - 1) : NaN)
      const right = micromarkClass(source.charCodeAt(end))
      const opens = right === undefined || (right === 'punctuation' && left !== undefined)
      const closes = left === undefined || (left === 'punctuation' && right !== undefined)
      const partner = open.length - 1
      if (closes && partner >= 0) {
        spans.add(open[partner])
        spans.add(index)
        open.pop()
      } else if (opens) {
        open.push(index)
      }
    }
    index = end
  }
  return spans
}

/**
 * A character reference — the form micromark's `characterReference` construct accepts: a numeric
 * one up to seven decimal or six hexadecimal digits, or a named one up to thirty-one alphanumerics,
 * each closed by the semicolon. Anything else is not a reference at all.
 */
const ENTITY_REFERENCE = /^&(#(?:\d{1,7}|x[\dA-Fa-f]{1,6})|[\dA-Za-z]{1,31});/

/**
 * The character a reference renders as, or null when the renderer leaves it as the literal text it
 * was written as — a name it does not know, or a number outside what a character can be.
 */
function decodeEntity(value: string): string | null {
  const numeric = /^#(?:x([\dA-Fa-f]{1,6})|(\d{1,7}))$/.exec(value)
  if (numeric) return decodeNumericCharacterReference(numeric[1] ?? numeric[2], numeric[1] ? 16 : 10)
  return decodeNamedCharacterReference(value) || null
}

/**
 * Whether a segment holds a link — a bracketed label a destination or reference follows. A link
 * inside a link's label is one the parser refuses, so the label's own brackets stay literal text:
 * finding one decides that the enclosing bracket run is not a link either. An image is allowed
 * inside a label, so only a label not written as one counts.
 *
 * Every run is matched in one forward walk and recorded by the index that opens it, so a candidate
 * is answered in constant time. Searching each candidate on its own made the cost quadratic in the
 * segment: a `](` whose destination never closes rescanned everything left of it, and a segment
 * built of thousands of those never finished.
 */
function holdsLink(source: string): boolean {
  const length = source.length
  // The index just past the delimiter closing the run each `[` or `(` opens, or −1 where it never
  // closes — the answers `pastBracketRun` and `pastParenRun` give, both of which read a backslash
  // as escaping the character after it.
  const bracketEnd = new Array<number>(length).fill(-1)
  const parenEnd = new Array<number>(length).fill(-1)
  const brackets: number[] = []
  const parens: number[] = []
  for (let index = 0; index < length; index += 1) {
    const character = source[index]
    if (character === '\\') index += 1
    else if (character === '[') brackets.push(index)
    else if (character === '(') parens.push(index)
    else if (character === ']' && brackets.length > 0) bracketEnd[brackets.pop() as number] = index + 1
    else if (character === ')' && parens.length > 0) parenEnd[parens.pop() as number] = index + 1
  }
  // The bracket opening the run each `]` closes, matched without the escape rule — how the label's
  // own brackets are paired when the run is found by walking back from its closing bracket.
  const labelOpen = new Array<number>(length).fill(-1)
  const labels: number[] = []
  for (let index = 0; index < length; index += 1) {
    if (source[index] === '[') labels.push(index)
    else if (source[index] === ']' && labels.length > 0) labelOpen[index] = labels.pop() as number
  }
  for (let close = 0; close < length - 1; close += 1) {
    if (source[close] !== ']' || (source[close + 1] !== '(' && source[close + 1] !== '[')) continue
    const start = labelOpen[close]
    // An image's label may hold a link, so a run written as one is not a candidate.
    if (start < 0 || (start > 0 && source[start - 1] === '!')) continue
    const after = close + 1
    if (source[after] === '(') {
      if (parenEnd[after] > after) return true
    } else if (bracketEnd[after] > 0) {
      return true
    }
  }
  return false
}

/**
 * The label content a heading's inline scan reads before it stops descending into labels. A label
 * nested in another costs a scan of the label it sits in, so nesting `d` deep costs `d` scans of
 * the heading — quadratic on a heading whose labels nest thousands deep, and the input is already
 * pathological by then. Past the budget a bracket run is read as the literal text it was written
 * as, which is what the renderer prints for a run that deep anyway.
 */
const MAX_HEADING_LABEL_CHARS = 64 * 1024

/**
 * A heading tag a raw HTML block renders — an element the parser hands the document whole, which
 * the renderer numbers an id from the same way it numbers a Markdown heading's.
 */
const HTML_HEADING_TAG = /<h([1-6])(?:[ \t][^>]*)?>([\s\S]*?)<\/h\1\s*>/gi

/** The text an HTML heading renders — its content with its own tags stripped and entities read. */
function htmlHeadingText(content: string): string {
  return content
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(#(?:\d{1,7}|x[\dA-Fa-f]{1,6})|[\dA-Za-z]{1,31});/g,
      (entity, value: string) => decodeEntity(value) ?? entity
    )
}

/** CommonMark's escapable set: the ASCII punctuation a backslash is a valid escape before. */
const ASCII_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/

/**
 * The plain text a heading's inline source renders — the text the renderer numbers the heading's
 * id from. A link renders its label while its destination stays out of the text, an image with a
 * destination and a raw tag or comment render none at all, and an autolink renders its URL. What
 * survives is punctuation the slug's normalizer absorbs, so emphasis and code markers pass through
 * untouched and only the constructs that carry readable text need reading.
 */
function headingRenderedText(source: string): string {
  let text = ''
  // Label content read so far, against the budget below.
  let labelChars = 0
  // The inline segments still to be read, innermost first. A link's label is queued here rather
  // than read by a recursive call: a heading whose label nests another label tens of thousands deep
  // would exhaust the call stack, and the renderer has no budget left for it either way.
  const pending: Array<{ text: string; label: boolean }> = [{ text: source, label: false }]
  while (pending.length > 0) {
    const entry = pending.pop() as { text: string; label: boolean }
    const segment = entry.text
    // A label is inline content of its own, so its emphasis pairs within it rather than across the
    // link that holds it. Matched on first use, so a segment with no emphasis never pays the scan.
    let spans: Set<number> | null = null
    // The strikethrough markers, matched the same way on their own first use.
    let strikes: Set<number> | null = null
    let index = 0
    while (index < segment.length) {
      const character = segment[index]
      if (character === '\\') {
        const next = segment[index + 1]
        // Markdown preserves a backslash before anything but ASCII punctuation — `C:\Users` renders
        // with the backslash, and the slug the renderer numbers the id from keeps it.
        if (next !== undefined && ASCII_PUNCTUATION.test(next)) {
          text += next
          index += 2
        } else {
          text += character
          index += 1
        }
      } else if (character === '`') {
        // A code span's content is literal, and only a run of the opener's own length closes it.
        const run = /^`+/.exec(segment.slice(index))?.[0] ?? '`'
        const close = segment.indexOf(run, index + run.length)
        const closed = close >= 0 && segment[close + run.length] !== '`'
        text += segment.slice(index + run.length, closed ? close : index + run.length)
        if (!closed) text += run
        index = closed ? close + run.length : index + run.length
      } else if (character === '&') {
        const entity = ENTITY_REFERENCE.exec(segment.slice(index))
        // A reference the renderer refuses stays the literal text it was written as.
        const decoded = entity ? decodeEntity(entity[1]) : null
        if (entity && decoded !== null) {
          text += decoded
          index += entity[0].length
        } else {
          text += character
          index += 1
        }
      } else if (character === '<') {
        const rest = segment.slice(index)
        const autolink =
          /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*)>/.exec(rest) ?? /^<([^\s<>@]+@[^\s<>@]+)>/.exec(rest)
        // An autolink renders its URL; a tag, comment or declaration renders no text of its own.
        const raw = autolink
          ? null
          : (/^<!--[\s\S]*?-->|^<\?[^\n]*?\?>|^<!\[CDATA\[[\s\S]*?\]\]>|^<![A-Za-z][^<>]*>/.exec(rest) ??
            /^<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*[ \t]*\/?>/.exec(
              rest
            ))
        if (autolink) text += autolink[1]
        index += (autolink ?? raw)?.[0].length ?? 1
        if (!autolink && !raw) text += character
      } else if (character === '*' || character === '_') {
        const run = EMPHASIS_RUN.exec(segment.slice(index))?.[0] ?? character
        // Only a run that paired with a partner is the markers of a span; one that did not is text.
        if (!(spans ??= emphasisSpans(segment)).has(index)) text += run
        index += run.length
      } else if (character === '~') {
        const run = TILDE_RUN.exec(segment.slice(index))?.[0] ?? character
        // The same for a strikethrough: only the run that found its partner renders nothing.
        if (!(strikes ??= strikethroughSpans(segment)).has(index)) text += run
        index += run.length
      } else if ((character === '[' && !entry.label) || (character === '!' && segment[index + 1] === '[')) {
        const open = index + (character === '!' ? 1 : 0)
        const label = pastBracketRun(segment, open)
        // A destination or reference follows only a label that closed; otherwise the scan already
        // read to the end of the segment, and the run cannot be part of a construct at all.
        const reference =
          segment[label.end] === '[' ? pastBracketRun(segment, label.end) : { end: label.end, closed: true }
        const follow = label.closed
          ? segment[label.end] === '('
            ? pastParenRun(segment, label.end)
            : reference.closed
              ? reference.end
              : -1
          : -1
        // A link the label holds forbids the one around it, which leaves the outer brackets as text
        // — so the scan moves one character and reads the inner link where it stands. An image is
        // allowed inside a label, so only a link decides this. Every run is charged what it cost to
        // read, accepted or not: a rejected one is rescanned from the bracket after it, so leaving
        // it free let a run of nested labels cost its length squared.
        labelChars += label.end - open
        if (labelChars > MAX_HEADING_LABEL_CHARS) {
          text += segment.slice(index, label.end)
          index = label.end
          continue
        }
        const nested = label.closed && holdsLink(segment.slice(open + 1, label.end - 1))
        if (label.closed && !nested && follow >= label.end) {
          // A link renders its label; an image renders none once it has a destination, while one
          // without is the literal text the parser leaves standing. A label cannot hold a link, so
          // reading it is one level deep and never recurses again.
          if (character !== '!' || follow === label.end) {
            // The label is read where the link stands and the rest of the segment after it, so the
            // text keeps its document order: the remainder is queued first, then the label, and
            // this segment stops here rather than reading on past the link it just found.
            pending.push({ text: segment.slice(follow), label: false })
            pending.push({ text: segment.slice(open + 1, label.end - 1), label: true })
            break
          }
          index = follow
        } else if (nested) {
          text += character
          index += 1
        } else {
          // A bracket that opens a run no later bracket closes is text, and so is every bracket in
          // it: the scan has already read as far as `end`, so the run is appended whole rather than
          // rescanned from each bracket in turn.
          text += segment.slice(index, label.end)
          index = label.end
        }
      } else {
        text += character
        index += 1
      }
    }
  }
  return text
}

/**
 * The indent a line needs to continue a definition across a blank one. The parser requires four
 * columns there, so a shallower indented line after a blank is a paragraph of its own — and
 * carrying it would print that paragraph in every chunk.
 */
function continuesDefinitionAfterBlank(line: string | undefined): boolean {
  if (line === undefined || !INDENTED_LINE.test(line)) return false
  return leadingColumns(line) >= 4
}

/**
 * Whether a line a footnote definition holds leaves a paragraph of its own open — the state a lazy
 * line below continues. The parser measures the line's blocks from the four columns the footnote
 * holds its content at: a container opening there keeps the paragraph it starts, a complete block
 * closes the one before it, and anything else is that paragraph's own prose.
 */
function continuesFootnoteParagraph(carried: string): boolean {
  const view = afterColumns(4, pastQuoteMarkers(carried).content)
  if (!/\S/.test(view)) return false
  if (!startsBlock(view)) return true
  if (LIST_ITEM.test(view)) return !EMPTY_LIST_ITEM.test(view)
  return QUOTE_START.test(view)
}

/**
 * The bare text of a link reference definition and the lines it covers, or null when the line opens
 * none. The destination may sit a line below the label and the title a line below that, but nothing
 * may follow the destination except the title — so `[label]:\ntext` is a paragraph and
 * `[label]:\n/url` is not. Hoisting either the wrong way would show it in every chunk, so the span
 * has to be exact. The definition is returned without its block quote or list marker because that
 * container belongs to the chunk it was written in, and carrying it would render an empty one.
 */
/**
 * Where a label's run ends in `content`, and how many characters the parser counts it at — escapes
 * as the two written, the brackets themselves not at all. `closed` is false when the run reaches
 * the line's end still open, and null when an unescaped `[` makes the run no label at all.
 */
function labelRunClose(content: string): { closed: boolean; rest: string; counted: number } | null {
  let counted = 0
  for (let at = 0; at < content.length; at += 1) {
    const character = content[at]
    if (character === '\\') {
      at += 1
      counted += 2
    } else if (character === '[') {
      return null
    } else if (character === ']') {
      return { closed: true, rest: content.slice(at + 1), counted }
    } else {
      counted += 1
    }
  }
  return { closed: false, rest: '', counted }
}

/**
 * A link reference definition whose label wraps onto the lines below the one it opens on. The
 * parser reads the label whole and normalizes the line endings inside it to whitespace, so the
 * definition stands however many lines the label spans — and one collected only to its first line
 * is no definition at all. The span ends at the line carrying the label's closing bracket and its
 * colon; a blank line, a line the definition's container cannot follow, or a bracket the parser
 * refuses a label for ends the search with no definition.
 */
function wrappedLinkLabel(
  lines: string[],
  index: number,
  definitionSource: string,
  container: DefinitionContainer
): { text: string; tail: string; lines: number } | null {
  // A label opens at a bracket: prose that only carries the closing `]:` is a paragraph the way it
  // stands, and reading a label from its second character would hoist it as one.
  if (definitionSource[0] !== '[') return null
  let counted = 0
  const parts: string[] = []
  let span = 1
  let content = definitionSource.slice(1)
  for (;;) {
    const run = labelRunClose(content)
    if (run === null) return null
    counted += run.counted
    if (counted > MAX_LABEL_SOURCE_CHARS) return null
    if (run.closed) {
      // The colon belongs directly behind the closing bracket, on the line the label closes on:
      // anything else there — including the whitespace a single-line definition may not carry
      // between the two — leaves the line a paragraph.
      const after = /^:([ \t]*)([\s\S]*)$/.exec(run.rest)
      if (!after) return null
      // The closing line's bracket and destination are appended below, so only its label content
      // survives it — the raw line still ends in `]: destination`, and joining it in whole would
      // write the closing syntax twice.
      const labelLines = [definitionSource.slice(1), ...parts]
      labelLines[labelLines.length - 1] = content.slice(0, run.counted)
      return {
        // The label is carried the way it was written, line endings included — the parser reads
        // and normalizes it whole again wherever the definition lands.
        text: `[${labelLines.join('\n')}]:${after[1]}${after[2]}`,
        tail: after[2],
        lines: span
      }
    }
    const next = continuation(lines[index + span], container.quotes, container.quoteColumns, container.labelColumn)
    if (next === undefined) return null
    parts.push(next)
    span += 1
    content = next
  }
}

function linkDefinition(lines: string[], index: number): { text: string; lines: number } | null {
  const start = DEFINITION_CONTAINER.exec(lines[index])
  // A first marker indented four columns or more — a tab counts as up to four — opens indented
  // code, not a container, so no definition opens behind it.
  if (start && leadingColumns(lines[index]) >= 4) return null
  // Five columns or more of whitespace after any marker — between two markers, or between the
  // last marker and the label — leave what follows in indented code the container never sees.
  if (start && containerWhitespaceOpensCode(start[0])) return null
  const quotes = start ? quoteDepth(start[0]) : 0
  const quoteColumns = start ? quoteMarkerColumns(start[0]) : []
  // The column the definition itself starts at when the container ends with a list item's marker —
  // quotes alone hold their content wherever the marker chain leaves it, but an item's continuation
  // lines are measured from the column its content begins at, so that column gates them. Counted in
  // columns: a tab inside a marker advances to the next stop, so `-\t` spans four of them.
  const labelColumn = start !== null && /(?:[-+*]|\d{1,9}[.)])[ \t]+$/.test(start[0]) ? columnCount(start[0]) : -1
  // Without a container the label may sit at up to three columns of indent — the deepest the parser
  // still reads as a definition. A fourth column, or a tab — which spans four of them — leaves the
  // line in indented code, where no definition opens.
  const definitionSource = start ? lines[index].slice(start[0].length) : lines[index].replace(/^ {1,3}(?=\[)/, '')
  const label = LINK_DEFINITION_LABEL.exec(definitionSource)
  let body: string[]
  let tail: string
  let span: number
  if (label) {
    // A label the parser would refuse — one of whitespace alone, or one longer than the 999
    // characters it allows — leaves the line a paragraph. The count is over the label as written,
    // escapes included, rather than over the text those escapes resolve to.
    if (!/[^\s]/.test(label[1]) || label[1].length > MAX_LABEL_SOURCE_CHARS) return null
    body = [`[${label[1]}]:${label[2]}${label[3]}`]
    tail = label[3]
    span = 1
  } else {
    const wrapped = wrappedLinkLabel(lines, index, definitionSource, { quotes, quoteColumns, labelColumn })
    if (!wrapped) return null
    body = [wrapped.text]
    tail = wrapped.tail
    span = wrapped.lines
  }
  // The destination may sit a line below the label, but only when the label's own line ends with
  // the colon: a run that is present yet not a destination condemns the line to paragraphhood.
  const past = pastDestination(tail)
  if (past === null) {
    if (!/^[ \t]*$/.test(tail)) return null
    // The span counts the lines the label itself consumed, so the destination sits `span` lines
    // below the opening one: reading the line below it instead re-read a wrapped label's closing
    // line, and the `]:` it ends in became a destination that shadowed the real one.
    const next = continuation(lines[index + span], quotes, quoteColumns, labelColumn)
    if (next === undefined) return null
    const nextPast = pastDestination(next)
    if (nextPast === null) return null
    tail = nextPast
    body.push(next)
    span += 1
  } else {
    tail = past
  }
  // Whatever is left on the destination's line has to be a title, but the title may wrap: the parser
  // closes it on whichever line carries the closing delimiter, so one that is still open here is
  // taken from the lines below rather than rejected. Anything that is neither closed nor open, and
  // any title that never closes, is a paragraph rather than a definition. The closing delimiter is
  // then tracked a line at a time — retesting the whole title for every line below it rescans an
  // ever-longer string, so a title left open across a long document would cost its length squared.
  let titleClose: string | null = null
  let titleClosed = false
  // Whether the optional title opened on the line below the destination rather than on the
  // destination's own line. The parser accepts the destination-only definition before the attempt,
  // so a failure there rewinds to it — where a failure on the destination's own line leaves the
  // trailing text standing, and with it no definition at all.
  let titleOpensBelow = false
  // The definition as it stands with its destination alone, before the title is attempted. A title
  // that opens below the destination and fails across several lines has to be rewound whole: the
  // parser accepts the destination-only definition, so every rejected title line goes with it —
  // dropping only the last one left the earlier ones in the definition and re-emitted them.
  const withoutTitle = { body: [...body], span }
  if (/^[ \t]*$/.test(tail)) {
    const below = continuation(lines[index + span], quotes, quoteColumns, labelColumn)
    if (below !== undefined && (LINK_TITLE.test(below) || LINK_TITLE_OPEN.test(below))) {
      titleOpensBelow = true
      titleClose = titleClosingDelimiter(below)
      titleClosed = LINK_TITLE.test(below)
      body.push(below)
      span += 1
    }
  } else if (LINK_TITLE.test(tail) || LINK_TITLE_OPEN.test(tail)) {
    titleClose = titleClosingDelimiter(tail)
    titleClosed = LINK_TITLE.test(tail)
  } else {
    return null
  }
  while (titleClose !== null && !titleClosed) {
    const next = continuation(lines[index + span], quotes, quoteColumns, labelColumn)
    const scan = next === undefined ? undefined : scanTitleContinuation(next, titleClose)
    // A blank line, or one the definition's container cannot follow, ends the title's paragraph —
    // the attempt dies where the parser's would.
    if (next === undefined || scan === 'dead') {
      if (titleOpensBelow) {
        body = [...withoutTitle.body]
        span = withoutTitle.span
        break
      }
      return null
    }
    body.push(next)
    span += 1
    titleClosed = scan === 'closed'
  }
  return { text: body.join('\n'), lines: span }
}

/**
 * The content a definition continuation line carries, or undefined when it is not one of ours.
 *
 * The parser continues a definition only while the line stays inside the container that holds it,
 * and it reads a marker on a continuation line as the start of a new block rather than as more
 * container. So a continuation may carry fewer quote markers than the definition was written
 * behind, but never more: each marker beyond the definition's own opens a deeper quote than the one
 * the definition lives in, and a list marker is never dropped either, because a list opened there
 * ends the definition. The indentation that follows a marker is what tells the parser the line
 * continues this definition rather than starting a new block, so it is left in place.
 */
function continuation(
  line: string | undefined,
  quotes: number,
  quoteColumns: number[],
  labelColumn: number
): string | undefined {
  if (line === undefined) return undefined
  let content = line
  let seen = 0
  let consumed = 0
  // The first marker may sit behind a tab that carries a list item's indent, so it is measured in
  // columns rather than by the spaces-only run the nesting markers allow: within the floor an
  // item-held quote sets (plus three, the indent a marker may take), or within three columns of
  // the line start otherwise. Below the floor the marker opens a sibling quote and ends the
  // definition; past the floor's reach it is code the marker never surfaces from, and the line
  // falls through to the lazy reading below.
  const first = /^[ \t]*>/.exec(content)
  if (first) {
    const floor = quoteColumns[0] ?? -1
    const column = leadingColumns(content)
    if (floor >= 0 && column < floor) return undefined
    if ((floor >= 0 && column <= floor + 3) || (floor < 0 && column <= 3)) {
      let eaten = first[0].length
      if (content.length > eaten && /[ \t]/.test(content[eaten])) eaten += 1
      consumed += eaten
      content = content.slice(eaten)
      seen = 1
    }
  }
  for (let quote = QUOTE_MARKER.exec(content); quote; quote = QUOTE_MARKER.exec(content)) {
    // A quote that sits further left than the container's k-th quote has fallen out of the list
    // items that hold it, and opens a block of its own instead of continuing the definition. The
    // leading run QUOTE_MARKER allows is spaces only, so the marker's own text needs no tab
    // arithmetic — only the characters consumed before it might carry tabs.
    const floor = quoteColumns[seen] ?? -1
    if (floor >= 0 && columnCount(line.slice(0, quote.index + quote[0].indexOf('>') + consumed)) < floor) {
      return undefined
    }
    consumed += quote[0].length
    content = content.slice(quote[0].length)
    seen += 1
  }
  if (seen > quotes) return undefined
  // A line that falls short of the container — a quote marker it does not reproduce, or an indent
  // that does not reach the column the definition itself starts at — continues it only as a lazy
  // paragraph line, which the parser guards with none of its interrupt rules.
  const lazy = seen < quotes || (labelColumn > 0 && leadingColumns(content) < labelColumn)
  if (lazy) {
    if (endsLazyParagraph(content)) return undefined
  } else {
    // Inside the item, the parser measures the line's blocks from the column the definition starts
    // at, so the indent in front of them belongs to the definition rather than turning them into
    // code.
    if (interruptsParagraph(labelColumn > 0 ? afterColumns(labelColumn, content) : content)) return undefined
  }
  return /\S/.test(content) ? content : undefined
}

/**
 * A list item marker, with the indentation and the marker that identify its list. A list ends where
 * its marker changes: `- a` and `* b` are two lists, as are `1. a` and `2) b`.
 */
const LIST_ITEM = /^( {0,3})(?:([-+*])|(\d{1,9})([.)]))(?=[ \t]|$)/

/** Not a list item but a thematic break, which ends the list above it. */
const THEMATIC_BREAK = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/

/**
 * The marker a definition list's description opens with, which the renderer reads as the term the
 * paragraph above it holds — the colon takes whitespace or the line's end behind it, and text
 * written directly behind it is the paragraph it looks like.
 */
const DEFINITION_LIST_DESCRIPTION = /^ {0,3}:(?=[ \t]|$)/

/**
 * A block start at column 0. Lazy continuation is the only line a list item owns there, and it never
 * starts a block, so one of these always ends an open list.
 */
const TOP_LEVEL_BLOCK_START =
  /^#{1,6}(?:[ \t]|$)|^>|^[-+*](?:[ \t]|$)|^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/

/** The environments `remarkLatexMath` treats as display math. */
const LATEX_ENVIRONMENTS = 'equation\\*?|align\\*?|aligned|gather\\*?|gathered|multline\\*?'

/**
 * A display math run open across lines, with the nesting its own delimiters count. `remarkLatexMath`
 * accepts the close only once the depth is back to one, so `\[ … \[ … \] … \]` and a repeated
 * `\begin{align}` each end at their second close and cannot be cut in half before it.
 */
interface MathRun {
  /** Raises the depth: the delimiter the run opened with. */
  open: RegExp
  /** Lowers it: the delimiter that closes the run. */
  close: RegExp
  depth: number
}

/**
 * The depth `run` leaves open after `line`, scanning it the way the parser does: a backslash is
 * consumed together with the character after it, so `\\[` is a literal backslash and only the run's
 * own delimiters move the depth.
 */
function trackMathRun(run: MathRun, line: string): MathRun | null {
  let { depth } = run
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '\\') continue
    if (run.open.test(line.slice(i))) depth += 1
    else if (run.close.test(line.slice(i))) depth -= 1
    i += 1
    if (depth <= 0) return null
  }
  return { ...run, depth }
}

/**
 * The display math run a line opens at its head, or null. The `$$` form is tracked separately,
 * because it closes with the same delimiter it opens with.
 */
function openMathRun(line: string): MathRun | null {
  const environment = new RegExp(`^\\s{0,3}\\\\begin\\{(${LATEX_ENVIRONMENTS})\\}`).exec(line)
  const bracket = environment ? null : /^\s{0,3}\\\[(?!.*\\\])/.exec(line)
  const opener = environment ?? bracket
  if (!opener) return null
  const run: MathRun = environment
    ? {
        open: new RegExp(`^\\\\begin\\{${environment[1]}\\}`),
        close: new RegExp(`^\\\\end\\{${environment[1]}\\}`),
        depth: 1
      }
    : { open: /^\\\[/, close: /^\\\]/, depth: 1 }
  return trackMathRun(run, line.slice(opener[0].length))
}

/** The length of the `$$` fence that opens display math at the head of `line`, or 0. */
function dollarFenceAtStart(line: string): number {
  return /^ {0,3}(\${2,})/.exec(line)?.[1].length ?? 0
}

/** The length of the `$$` fence at the end of `line`, or 0. */
function dollarFenceAtEnd(line: string): number {
  return /(\${2,})[ \t]*$/.exec(line)?.[1].length ?? 0
}

/**
 * `$$x$$` opens and closes on its own line, which the parser leaves to the inline tokenizer: there
 * is no block for a boundary to fall inside.
 */
function dollarFenceClosesOnOwnLine(line: string, fence: number): boolean {
  return [...line.matchAll(/\$+/g)].slice(1).some((match) => match[0].length === fence)
}

interface ListRun {
  indent: string
  /** The marker that identifies the list: a bullet character or an ordered delimiter. */
  marker: string
}

function trackListItem(run: ListRun | null, item: RegExpExecArray): ListRun {
  const [, indent, bullet, , delimiter] = item
  // A deeper marker belongs to a nested list, which the run above it already spans.
  if (run && indent.length > run.indent.length) return run
  return { indent, marker: bullet ?? delimiter }
}

/** The windowed document, and from the same pass what windowing cannot fix. */
export interface MarkdownWindow {
  chunks: MarkdownChunk[]
  /**
   * The source is so dominated by very long lines that no boundary helps — the one shape the split
   * cannot break up. Measured while walking the lines, not in a second pass over the source.
   */
  longLines: boolean
}

/**
 * Split markdown source into independently renderable chunks, breaking on blank lines only.
 *
 * @param content - The markdown source.
 * @param budgetChars - Soft per-chunk size target; a chunk may exceed it when no safe boundary
 *   exists before the budget runs out.
 */
export function splitMarkdownChunks(
  content: string,
  budgetChars: number = MARKDOWN_CHUNK_BUDGET_CHARS
): MarkdownWindow {
  if (content.length === 0) return { chunks: [], longLines: false }

  // CommonMark normalizes CRLF, and a bare CR, to LF before parsing, so chunks carry LF too. Every
  // line-anchored match below would otherwise be blind to the terminator a document leaves at each
  // line end: a `$$` run that never closes, or a list marker that never matches, suppresses every
  // later boundary and sends the whole document to the plain-text fallback.
  const lines = content.split(/\r\n|\r|\n/)
  // A trailing terminator ends its line rather than starting another, so the split's last element is
  // not a line. The long-line average counts lines, and an extra empty one would halve it.
  const lineCount = content.length > 0 && /[\r\n]$/.test(content) ? lines.length - 1 : lines.length
  // The next line with content on it, so a run of blank lines belongs to the block that spans it.
  const nextContent = new Array<number>(lines.length).fill(-1)
  for (let i = lines.length - 2, next = -1; i >= 0; i--) {
    if (lines[i + 1].trim() !== '') next = i + 1
    nextContent[i] = next
  }

  const definitions: string[] = []
  // A definition may cover up to three source lines while occupying one entry here, so the carried
  // prefix is measured in lines rather than entries — the virtualizer estimates from this count.
  let definitionLines = 0
  const boundaries: number[] = []
  let contentChars = 0
  let bufferChars = 0
  let fence: Fence | null = null
  let dollarFence = 0
  let mathRun: MathRun | null = null
  let htmlTerminator: RegExp | null = null
  /**
   * The container the open terminator block's lines have to carry on reproducing, or null at the
   * top level. The block belongs to the quote or list item it was written in, so a line that
   * drops those markers ends it — with the container — and is read again outside it.
   */
  let htmlTerminatorContainer: string | null = null
  // A block-level HTML block (a type-6 tag or a type-7 one, the raw types having their own
  // terminator above) runs to the next blank line, and everything it holds is HTML the parser reads
  // as text — no definition opens inside it and nothing else opens there either.
  let htmlBlankBlock = false
  /**
   * The container the open HTML block's lines have to carry on reproducing, or null at the top
   * level. A block belongs to the quote or list item it was written in, so a line that drops those
   * markers ends the block as surely as a blank line does — `> <div>` followed by an unquoted line
   * leaves the quote, and the HTML block it held, behind it.
   */
  let htmlBlockContainer: string | null = null
  // The elements the HTML blocks read so far have left open. A blank line ends the parser's block,
  // but not the element its opening tag began — the renderer holds everything below it inside that
  // element until the closing tag turns up — so a boundary may not fall while one is open.
  const htmlOpenElements: string[] = []
  // The stack's height when the open block began, so the elements it opened can be given back when
  // the container it was written behind ends with it.
  let htmlBlockElementBase = 0
  let inDefinition = false
  let footnoteDefinition = false
  let run: ListRun | null = null
  /**
   * Whether the previous content line left a paragraph open. A link definition cannot interrupt a
   * paragraph, so this decides whether a definition-shaped line is a definition or paragraph text —
   * and only a paragraph still open bars one: a heading, an underline, a thematic break or a carried
   * definition is complete where it stands, so the line below opens a definition freely.
   */
  let previousStatus: 'paragraph' | 'block' = 'block'
  /** The container prefix the line was written behind, when it opened a paragraph. */
  let paragraphContainer: string | null = null
  /** The line the open paragraph starts at — the text a setext underline turns into a heading. */
  let paragraphStart = 0
  // The container the open footnote definition was written behind, so its continuation lines can
  // lose the markers the way the opening line did.
  let activeDefinitionContainer: DefinitionContainer | null = null
  // Whether the open definition spans a blank line inside its container: past one, the parser holds
  // a continuation to four columns measured inside the container.
  let sawBlankInDefinition = false
  // Whether the open footnote definition holds a paragraph a lazy line below continues. The parser
  // reads a line the note's four columns fall short of as that paragraph's own, so the line belongs
  // to the definition wherever the reference to it renders.
  let footnoteParagraphOpen = false
  /**
   * The fenced code block open behind an enclosing container, or null. A fence opened behind quote
   * or list markers (`- ``` `, `> - ``` `) is content that block holds, so its lines reach
   * `parseFence` only after those markers come away — those lines are code, and a definition-shaped
   * one among them must not be carried.
   */
  let containerFence: ContainerFence | null = null
  // Heading ids must match what the unsplit document would assign, so slugs are numbered in
  // document order as the walk meets the headings — behind quote or list markers a heading still
  // counts, inside a fence or an HTML block it does not — and each chunk receives the slugs of the
  // headings its lines render. The entries are keyed by the line the heading's text sits on, and a
  // line may render more than one heading, so each holds every occurrence in document order.
  const slugOrder = new Map<string, string[]>()
  const lineHeadings = new Array<{ base: string; slug: string }[] | undefined>(lines.length).fill(undefined)
  const recordHeading = (line: number, text: string): void => {
    const base = normalizeHeadingText(text)
    const seen = slugOrder.get(base) ?? []
    const slug = seen.length === 0 ? base : `${base}-${seen.length}`
    seen.push(slug)
    slugOrder.set(base, seen)
    ;(lineHeadings[line] ??= []).push({ base, slug })
  }
  // A raw HTML block's lines are the tags the renderer parses into elements, so a complete heading
  // tag anywhere in the block numbers the document's ids the same way an ATX heading does — one a
  // single line may hold several of. The block is scanned whole, since its tag, text and closing
  // tag may sit on different lines.
  const recordHtmlHeadings = (line: number, content: string): void => {
    for (const match of content.matchAll(HTML_HEADING_TAG)) recordHeading(line, htmlHeadingText(match[2]))
  }
  // The raw text of the open HTML block, gathered line by line to scan once the block closes: a
  // heading counted line by line would miss one whose tag spans lines, and counting it on the line
  // its tag opens keeps it in the chunk that renders the element.
  let htmlBlockStart = 0
  let htmlBlockContent: string[] = []
  /** The comment an HTML block's lines may have left open, whose contents are no one's tags. */
  const htmlComment = { open: false }
  const closeHtmlBlock = (): void => {
    recordHtmlHeadings(htmlBlockStart, htmlBlockContent.join('\n'))
    htmlBlockContent = []
    htmlComment.open = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const blank = line.trim() === ''
    bufferChars += line.length + 1
    contentChars += line.length

    if (fence) {
      if (isClosingFence(line, fence)) fence = null
      continue
    }
    if (htmlTerminator) {
      if (htmlTerminator.test(line)) {
        htmlTerminator = null
        htmlTerminatorContainer = null
        continue
      }
      // A line that drops the block container's markers ends the block as the terminator would —
      // the quote or item it belongs to is over — so it is read again below, where the top level
      // it now sits at may open a definition. Blank lines, and lines that reproduce the markers,
      // stay inside: the raw types run to their terminator across both.
      const stripped =
        htmlTerminatorContainer === null
          ? line
          : stripDefinitionContainer(line, containerParams(htmlTerminatorContainer))
      if (stripped !== null) continue
      htmlTerminator = null
      htmlTerminatorContainer = null
    }
    if (htmlBlankBlock) {
      // A line that drops the container's markers ends the HTML block as a blank line would, so it
      // is read again below rather than swallowed. One that reproduces them continues it whatever
      // else it carries — the block's remaining lines are its text. A line that only falls short of
      // an item's content column stays inside: the item's blocks reach their own content column,
      // and a shallower line is the item's content rather than a block that leaves it.
      const stripped =
        htmlBlockContainer === null ? line : stripDefinitionContainer(line, containerParams(htmlBlockContainer))
      if (stripped !== null && !blank) {
        const uncommented = withoutHtmlComments(stripped, htmlComment)
        htmlBlockContent.push(uncommented)
        trackHtmlElements(uncommented, htmlOpenElements)
        continue
      }
      closeHtmlBlock()
      htmlBlankBlock = false
      // The elements a block written behind a container opened die with the container — the line
      // that dropped the markers, or the blank that ends the quote or item, is what closes them in
      // the renderer. Only a block at the top level leaves them spanning the blank that ends it.
      if (htmlBlockContainer !== null || stripped === null) htmlOpenElements.length = htmlBlockElementBase
    }
    if (mathRun) {
      mathRun = trackMathRun(mathRun, line)
      continue
    }
    if (dollarFence > 0) {
      if (dollarFenceAtEnd(line) >= dollarFence) dollarFence = 0
      continue
    }
    if (containerFence) {
      // The fence's lines are the content of the block its container opens: one that does not
      // reproduce the quote markers leaves the quote, and one that falls short of the item's
      // content column leaves the item — either way the fence ends with the block that held it, and
      // the line is read again below as an ordinary one. Blank lines, and marker lines whose
      // content is blank, stay inside: the code holds them.
      const inside = afterQuoteMarkers(line, containerFence.quotes)
      const base = inside === null ? 0 : columnCount(line.slice(0, line.length - inside.length))
      const short = inside !== null && containerFence.contentColumn > base + leadingColumns(inside)
      const blankish = inside !== null && inside.trim() === ''
      if (inside === null || (!blankish && short)) {
        containerFence = null
      } else {
        const stripped = afterColumns(Math.max(containerFence.contentColumn - base, 0), inside)
        if (!blankish && isClosingFence(stripped, containerFence.fence)) containerFence = null
        continue
      }
    }
    const opened = parseFence(line)
    if (opened) {
      fence = opened
      inDefinition = false
      previousStatus = 'block'
      paragraphContainer = null
      continue
    }
    // A definition behind a quote or list item is carried without that container, which belongs to
    // the chunk it was written in: carrying it would render an empty quote or list in every other.
    const container = DEFINITION_CONTAINER.exec(line)
    const uncontained = container ? line.slice(container[0].length) : line
    // The same code checks a link definition's own start applies here: a container indented to four
    // columns, or one whose markers leave five columns of whitespace behind them, holds its content
    // in indented code the parser never reads as a block.
    const containerHoldsCode =
      container !== null && (leadingColumns(line) >= 4 || containerWhitespaceOpensCode(container[0]))
    const htmlEnd = containerHoldsCode ? null : htmlBlockTerminator(uncontained)
    if (htmlEnd) {
      if (!htmlEnd.test(line)) {
        htmlTerminator = htmlEnd
        htmlTerminatorContainer = container?.[0] ?? null
      }
      inDefinition = false
      previousStatus = 'block'
      paragraphContainer = null
      continue
    }
    const dollarOpen = dollarFenceAtStart(line)
    if (dollarOpen > 0 && !dollarFenceClosesOnOwnLine(line, dollarOpen)) {
      dollarFence = dollarOpen
      inDefinition = false
      previousStatus = 'block'
      paragraphContainer = null
      continue
    }
    const math = openMathRun(line)
    if (math) {
      mathRun = math
      inDefinition = false
      previousStatus = 'block'
      paragraphContainer = null
      continue
    }
    // A fence the line opens behind quote or list markers: that block holds it, so `parseFence` sees
    // it only past those markers — `- ``` ` is three backticks behind a marker, and every line the
    // item indents to its content column is code the parser never reads for definitions.
    const openedFence = openContainerFence(line)
    if (openedFence) {
      containerFence = openedFence
      // An item that opens a fence still numbers its list, so the blank line behind the fence may
      // not split the next item away from it — the same reason an ordinary item keeps the run alive.
      const item = LIST_ITEM.exec(line)
      if (item) run = trackListItem(run, item)
      inDefinition = false
      previousStatus = 'block'
      paragraphContainer = null
      continue
    }
    // An HTML block swallows the lines to its blank one as raw text — a definition-shaped line among
    // them is text the parser never reads as one. A type-7 block, a complete tag on a line of its
    // own, opens only where a paragraph is not open: it cannot interrupt one.
    if (
      !containerHoldsCode &&
      (opensHtmlBlock(uncontained) || (previousStatus === 'block' && COMPLETE_TAG_LINE.test(uncontained)))
    ) {
      htmlBlankBlock = true
      // The block lives in the container it was opened behind, so its lines have to keep that
      // container: the marker chain the opening line carried, and an item's content column.
      htmlBlockContainer = container?.[0] ?? null
      htmlBlockStart = i
      htmlComment.open = false
      const opening = withoutHtmlComments(uncontained, htmlComment)
      htmlBlockContent = [opening]
      htmlBlockElementBase = htmlOpenElements.length
      trackHtmlElements(opening, htmlOpenElements)
      inDefinition = false
      previousStatus = 'block'
      paragraphContainer = null
      continue
    }
    // A multi-paragraph footnote definition continues on indented lines, including across its blank
    // lines — where the parser holds it to four columns, so a shallower one starts a new block.
    // A definition written behind a container carries its markers on those lines too: strip them
    // first, and judge the continuation by the content the parser reads inside the container.
    const definitionContainer = inDefinition ? activeDefinitionContainer : null
    const insideContainer = definitionContainer ? stripDefinitionContainer(line, definitionContainer) : null
    // Indented code is a block of its own rather than a paragraph, so a line below it is free to
    // open a definition — the same as it is after a heading. The code itself is no paragraph: the
    // walk reaches here only for lines the containers above did not take, so `    code` lands on
    // the branch that sets paragraph state, and without this test it would hold one open. Four
    // columns are the parser's own floor: one to three leave the line a paragraph, and the state
    // a definition-shaped line below it has to meet is that paragraph's. Code also cannot
    // interrupt a paragraph — the indent under one is its own lazy line — so only a line free of
    // an open paragraph may open it.
    const indentedCode = !blank && previousStatus === 'block' && leadingColumns(line) >= 4 && !startsBlock(line)
    const indentedContinuation =
      definitionContainer && insideContainer !== null
        ? // A marker-only line behind the definition's container (`>` on its own) is blank the way
          // the parser sees it: the quote reproduces the line and the definition spans it.
          insideContainer.trim() === '' ||
          (INDENTED_LINE.test(insideContainer) && !startsBlock(insideContainer) && !sawBlankInDefinition) ||
          // Past a blank line the definition owns only lines the parser counts as indented to four
          // columns inside the container — `>  second` behind a `>` quote carries two, so it is a
          // quoted paragraph of its own and carrying it would print it in every chunk.
          (sawBlankInDefinition && continuesDefinitionAfterBlank(insideContainer) && !startsBlock(insideContainer)) ||
          (blank && continuesDefinitionAfterBlank(strippedNextContent(lines, nextContent, i, definitionContainer)))
        : indentedCode || (blank && continuesDefinitionAfterBlank(lines[nextContent[i]]))
    // A blank line the definition spans — a bare one, or the definition's own container markers on
    // a line of their own (`>`), which is blank the way the parser sees it — ends no container, so
    // it has to be remembered for the continuation line that follows it. Either kind ends the
    // paragraph a lazy line below would continue.
    if (blank && inDefinition && footnoteDefinition) footnoteParagraphOpen = false
    if (definitionContainer && insideContainer !== null && (blank || insideContainer.trim() === '')) {
      sawBlankInDefinition = true
      footnoteParagraphOpen = false
    }
    // A line the note's four columns fall short of can still continue the paragraph the note holds
    // — lazily, the way the parser reads it: the container's markers dropped outright, and no block
    // of the line's own. It belongs to the definition, so the note renders whole in the chunk that
    // references it, not just in the one its lines landed in.
    const footnoteLazyContent = (() => {
      if (!inDefinition || !footnoteDefinition || !footnoteParagraphOpen || blank || indentedContinuation)
        return undefined
      if (activeDefinitionContainer) {
        const stripped = stripDefinitionContainer(line, activeDefinitionContainer)
        if (stripped !== null) return endsLazyParagraph(stripped) ? undefined : stripped
        // A line short of the container is lazy the same way, its markers dropped outright — and
        // the walk it takes past the markers is what rejects one the definition cannot follow.
        return continuation(
          line,
          activeDefinitionContainer.quotes,
          activeDefinitionContainer.quoteColumns,
          activeDefinitionContainer.labelColumn
        )
      }
      return endsLazyParagraph(line) ? undefined : line
    })()
    if (
      inDefinition &&
      (indentedContinuation ||
        (footnoteLazyContent !== undefined && !FOOTNOTE_DEFINITION_START.test(footnoteLazyContent))) &&
      (!blank || footnoteDefinition)
    ) {
      // Continuation lines behind the definition's container carry its markers (`>` on a quoted
      // definition's blank line, or `>` plus indentation on its paragraphs). The definition was
      // carried without that container, so its lines lose it too: markers strip away and the
      // content keeps the columns the parser measures past them.
      const carried =
        activeDefinitionContainer && !blank ? stripDefinitionContainer(line, activeDefinitionContainer) : line
      if (carried !== null) {
        // A quoted definition's blank marker line carries as a plain blank line: the parser reads
        // the definition's paragraphs across it, and `>` alone would start a quote block of its own.
        definitions.push(carried.trim() === '' ? '' : carried)
        definitionLines += 1
        if (carried.trim() !== '') footnoteParagraphOpen = continuesFootnoteParagraph(carried)
        continue
      }
      definitions.push(line)
      definitionLines += 1
      footnoteParagraphOpen = continuesFootnoteParagraph(line)
      continue
    }
    const footnoteStart = containerHoldsCode ? null : FOOTNOTE_DEFINITION_START.exec(uncontained)
    if (footnoteStart) {
      definitions.push(uncontained)
      definitionLines += 1
      inDefinition = true
      footnoteDefinition = true
      sawBlankInDefinition = false
      footnoteParagraphOpen = continuesFootnoteParagraph(footnoteStart[1])
      // The definition keeps the container it was written behind: its continuation lines must
      // lose that container the same way the opening line did, or the carried prefix holds only
      // the first line and a truncated copy shadows the complete definition.
      activeDefinitionContainer = container ? containerParams(container[0]) : null
      // A definition written as a list item still numbers that list, so the blank line behind it
      // may not end one — the same reason an ordinary item keeps the run alive.
      const item = LIST_ITEM.exec(line)
      if (item) run = trackListItem(run, item)
      previousStatus = 'block'
      paragraphContainer = null
      continue
    }
    // A link definition cannot interrupt a paragraph: a definition-shaped line under an open
    // paragraph is paragraph text, and hoisting it would shadow the real definition. A container
    // opener that breaks that paragraph — a deeper quote, or a list marker, which opens a fresh
    // item — leaves the definition standing behind it.
    const opensBlock = container !== null && containerOpensBlock(container[0], paragraphContainer ?? '')
    const definition =
      (previousStatus === 'paragraph' && !opensBlock) || containerHoldsCode ? null : linkDefinition(lines, i)
    if (definition) {
      definitions.push(definition.text)
      definitionLines += definition.lines
      bufferChars += definition.text.length + 1
      i += definition.lines - 1
      inDefinition = false
      activeDefinitionContainer = null
      const item = LIST_ITEM.exec(line)
      if (item) run = trackListItem(run, item)
      previousStatus = 'block'
      paragraphContainer = null
      continue
    }
    inDefinition = false
    // Heading ids are numbered over the whole document, so a heading is recorded where it renders:
    // an ATX heading where it stands, a setext one on the paragraph its underline turns into one —
    // which the parser reads whole, line after line.
    if (!blank && !containerHoldsCode) {
      const atx = ATX_HEADING.exec(uncontained)
      if (atx) {
        recordHeading(i, headingRenderedText(atx[1] ?? ''))
      } else if (previousStatus === 'paragraph' && SETEXT_UNDERLINE.test(uncontained)) {
        // The underline completes the open paragraph, but only in the container that paragraph sits
        // in: a marker that opens a block of its own leaves it a line of prose instead.
        const paragraphPrefix = DEFINITION_CONTAINER.exec(lines[paragraphStart])?.[0] ?? ''
        const underlinePrefix = container?.[0] ?? ''
        if (
          quoteDepth(underlinePrefix) === quoteDepth(paragraphPrefix) &&
          !containerOpensBlock(underlinePrefix, paragraphPrefix)
        ) {
          const text = lines
            .slice(paragraphStart, i)
            .map((part) => part.slice((DEFINITION_CONTAINER.exec(part)?.[0] ?? '').length))
            .join('\n')
          recordHeading(paragraphStart, headingRenderedText(text))
        }
      }
    }
    // A blank line ends a paragraph; any other non-definition line here either opens a block that
    // is complete where it stands — a heading, the underline that completes the line above, or a
    // thematic break — or it is plain paragraph text flowing on.
    if (blank) {
      previousStatus = 'block'
      paragraphContainer = null
    } else {
      // A setext underline may turn the whole open paragraph into a heading, so its first line is
      // remembered: a line that opens a block of its own ends the paragraph above rather than
      // joining it.
      if (previousStatus !== 'paragraph' || opensBlock) paragraphStart = i
      // Indented code is a block of its own, so the line under it starts from no open paragraph —
      // which is what lets the definition there stand instead of reading as paragraph text.
      previousStatus = indentedCode || isCompletedBlock(line, container?.[0] ?? null) ? 'block' : 'paragraph'
      paragraphContainer = container?.[0] ?? null
    }

    // A thematic break carries an item marker at its head but is a block of its own.
    const item = THEMATIC_BREAK.test(line) ? null : LIST_ITEM.exec(line)
    if (item) {
      run = trackListItem(run, item)
      continue
    }
    if (TOP_LEVEL_BLOCK_START.test(line)) run = null

    // A blank line ends the current block, so it is the only place a chunk may safely end.
    if (!blank) continue
    const followedBy = nextContent[i]
    if (followedBy >= 0 && INDENTED_LINE.test(lines[followedBy])) continue
    // The paragraph the blank follows is the term of a description the next line opens — the
    // renderer reads the two as one construct across the blank, and cut there the description
    // renders the plain paragraph it is only without its term.
    if (
      i > 0 &&
      lines[i - 1].trim() !== '' &&
      followedBy >= 0 &&
      DEFINITION_LIST_DESCRIPTION.test(pastQuoteMarkers(lines[followedBy]).content)
    ) {
      continue
    }
    const nextItem = followedBy >= 0 ? LIST_ITEM.exec(lines[followedBy]) : null
    // A list is one block: its items number themselves from its first marker and its blank lines
    // are what make it loose, so only a blank line the list does not span is free. The marker
    // alone names the list — an item written at any column up to three is its sibling, so the
    // indentation an item happens to carry does not end one. (A deeper marker never reaches this
    // check: the indented-continuation guard above has already held that blank.)
    const listContinues = run !== null && nextItem !== null && (nextItem[2] ?? nextItem[4]) === run.marker
    if (listContinues) continue
    run = null
    // An element a blank line only spans holds the blocks below it: one that never closes keeps
    // every later boundary off, and the oversized fallback a chunk that size trips is the exit.
    if (bufferChars >= budgetChars && htmlOpenElements.length === 0) {
      boundaries.push(i + 1)
      bufferChars = 0
    }
  }
  // A block still open at the end of the document closes here, its headings counted with the rest.
  if (htmlBlankBlock) closeHtmlBlock()

  const prefix = definitions.length > 0 ? `${definitions.join('\n')}\n\n` : ''
  const prefixLines = definitionLines > 0 ? definitionLines + 1 : 0
  const chunks: MarkdownChunk[] = []
  let start = 0
  for (const end of [...boundaries, lines.length]) {
    if (end <= start) continue
    const chunkSlugs = new Map<string, string[]>()
    for (let i = start; i < end; i++) {
      for (const heading of lineHeadings[i] ?? []) {
        const assigned = chunkSlugs.get(heading.base) ?? []
        assigned.push(heading.slug)
        chunkSlugs.set(heading.base, assigned)
      }
    }
    chunks.push({
      text: prefix + lines.slice(start, end).join('\n'),
      lines: prefixLines + end - start,
      ...(chunkSlugs.size > 0 ? { headingSlugs: chunkSlugs } : {})
    })
    start = end
  }
  return { chunks, longLines: isPathologicalLineShape(lineCount, contentChars) }
}

/**
 * Whether some chunk is too large to mount — one that would still reach the renderer whole.
 *
 * @param chunks - The chunks `splitMarkdownChunks` produced.
 */
export function hasOversizedMarkdownChunk(chunks: MarkdownChunk[]): boolean {
  return chunks.some((chunk) => chunk.text.length > MARKDOWN_MAX_BLOCK_CHARS)
}
