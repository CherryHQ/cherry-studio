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

/** Markdown's blank line: spaces and tabs only — a line holding any other character is content. */
const isBlankLine = (line: string): boolean => /^[ \t]*$/.test(line)

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

/** The widest tag the heading text reads; bounding the slice keeps malformed runs linear. */
const MAX_TAG_WINDOW = 4_096

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
 * How a line stands to the container fence open above it: code the fence holds, the closing fence
 * that ends it, or a line that leaves the container and so ends it too.
 */
function containerFenceStep(line: string, open: ContainerFence): 'code' | 'close' | 'end' {
  const inside = afterQuoteMarkers(line, open.quotes)
  if (inside === null) return 'end'
  const base = columnCount(line.slice(0, line.length - inside.length))
  const blankish = isBlankLine(inside)
  if (!blankish && open.contentColumn > base + leadingColumns(inside)) return 'end'
  const stripped = afterColumns(Math.max(open.contentColumn - base, 0), inside)
  return !blankish && isClosingFence(stripped, open.fence) ? 'close' : 'code'
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
const FOOTNOTE_DEFINITION_START = /^ {0,3}\[\^([^\][\s]+)]:(.*)$/

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
 * returning the content the parser reads there — or null when the line falls short of that
 * container and so leaves the definition's block. Block quote markers strip off one per level
 * while a list item's marker is content-prefixed rather than reproduced: its continuation lines
 * are indented to the item's content column, so that much whitespace comes away with them, and
 * only whitespace counts toward the column — ordinary characters never do.
 */
function stripDefinitionContainer(line: string, container: DefinitionContainer): string | null {
  let content = line
  for (let quote = 0; quote < container.quotes; quote += 1) {
    const marker = QUOTE_MARKER.exec(content)
    if (!marker) return null
    content = content.slice(marker[0].length)
  }
  if (container.labelColumn < 0) return content
  // An item's content column is measured past its marker; only indentation counts toward it, and
  // the content's column is counted on the line itself, quote markers included — a tab advances to
  // the next multiple of four wherever it falls.
  let index = line.length - content.length
  let column = columnCount(line.slice(0, index))
  while (index < line.length && column < container.labelColumn && (line[index] === ' ' || line[index] === '\t')) {
    column += line[index] === '\t' ? 4 - (column % 4) : 1
    index += 1
  }
  if (column < container.labelColumn) return null
  // The indentation up to the content column belongs to the item, and the carried definition is
  // written without it: re-basing the line here keeps the blocks the parser finds inside the note
  // inside it, and the ones it finds outside outside. A tab spanning past the column leaves the
  // columns it overshoots as spaces, the way `afterColumns` keeps them.
  return `${' '.repeat(Math.max(column - container.labelColumn, 0))}${line.slice(index)}`
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
 * The form a reference label is matched by: the source it was written in — an escape stays part of
 * the label, so `[r\*]` does not match a definition for `[r*]` — with markdown whitespace, which a
 * label that wraps carries a line ending as, collapsed to one space and the case folded. Two labels
 * in this form are the one the parser resolves a reference against.
 */
function normalizeReferenceLabel(label: string): string {
  return label
    .replace(/[\t\n\r ]+/g, ' ')
    .replace(/^ | $/g, '')
    .toLowerCase()
    .toUpperCase()
}

/**
 * The length of the bare destination opening at `open`, or 0 when none does. It ends at an ASCII
 * control or space — not `\S`, which also excludes the U+00A0 a destination may hold.
 */
function bareDestinationLength(line: string, open: number): number {
  // `<` belongs to the angle bracket form, never to a bare destination.
  if (line[open] === '<') return 0
  let index = open
  while (index < line.length) {
    const code = line.charCodeAt(index)
    if (code <= 0x20 || code === 0x7f) break
    index += 1
  }
  return index - open
}

/** The whitespace that may lead a definition's destination on its line. */
const LEADING_WHITESPACE = /^[ \t]*/

/**
 * The length of an angle-bracketed destination opening at `open`, or 0 when none does.
 *
 * A backslash escapes the character after it, so a `\>` is an escaped delimiter rather than the
 * close and the run continues past it — `<https://example.com/a\>b>` is one destination, and
 * reading the escaped `>` as the close leaves `b>` behind where a title belongs, which refuses the
 * whole definition. An unescaped `<` inside the run refuses it the same way: the parser reads
 * `[x]: <a<b>` as a paragraph, so accepting it here would hoist visible text into later chunks as
 * a carried definition.
 */
function angleDestinationLength(text: string, open: number): number {
  for (let index = open + 1; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\') {
      index += 1
    } else if (character === '<') {
      return 0
    } else if (character === '>') {
      return index + 1 - open
    }
  }
  return 0
}

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
  // An angle-bracketed destination is scanned by hand, because its closing delimiter may be escaped
  // and a character class cannot count the escapes that come before it.
  const open = /^[ \t]*</.exec(line)
  if (open) {
    const length = angleDestinationLength(line, open[0].length - 1)
    return length === 0 ? null : line.slice(open[0].length - 1 + length)
  }
  const indent = LEADING_WHITESPACE.exec(line)?.[0].length ?? 0
  const length = bareDestinationLength(line, indent)
  if (length === 0) return null
  const destination = line.slice(indent, indent + length)
  if (!balancedParens(destination)) return null
  return line.slice(indent + length)
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
  /**
   * The quoted runs the most recent unterminated scan walked over, as `[open, close]` pairs, or
   * null while no scan has failed yet. A tag opening inside one of them sees a different quote
   * structure than the scan that read past it, so only such a tag has to be walked again; every
   * other one starts where the failed scan was already in plain text and reaches the same dead end.
   */
  let deadRuns: Array<[number, number]> | null = null
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
    // The failed scan behind us read this far in plain text without finding a `>`, so a tag whose
    // own scan starts there walks the same dead suffix. Only a tag opening inside one of that
    // scan's quoted runs can reach a `>` the scan itself could not.
    if (deadRuns !== null && !deadRuns.some(([open, close]) => open < attrsStart && attrsStart <= close)) return
    let cursor = attrsStart
    let terminated = false
    const runs: Array<[number, number]> = []
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
        runs.push([cursor, end])
        cursor = end + 1
        continue
      }
      cursor += 1
    }
    if (terminated) {
      deadRuns = null
      yield {
        name: named[2].toLowerCase(),
        closing: named[1] === '/',
        selfClosing: /\/\s*$/.test(line.slice(attrsStart, cursor))
      }
      index = cursor + 1
      continue
    }
    deadRuns = runs
    index = at + 1
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
/**
 * The open-element stack a document's HTML blocks accumulate, with the two lookups the splitter
 * needs kept beside it. Both are maintained incrementally: the stack grows one push per opening
 * tag and shrinks only by truncation, so a `lastIndexOf` per closing tag, an `includes` per
 * opener, or a rebuild per line each made a block of ordinary tags cost its count squared.
 */
class HtmlElementStack {
  readonly names: string[] = []
  /**
   * Name → every position it holds in {@link names}, innermost last. Keeping the whole run is what
   * lets an inner close leave the outer element of the same name reachable: the stack only ever
   * shrinks by truncation, so each position is pushed once and popped once.
   */
  private readonly positions = new Map<string, number[]>()
  /** How many `svg`/`math` elements are open, which is what makes a nested tag foreign content. */
  private foreignDepth = 0

  isForeign(name: string): boolean {
    return name === 'svg' || name === 'math' || this.foreignDepth > 0
  }

  openTag(name: string): void {
    const held = this.positions.get(name)
    if (held) held.push(this.names.length)
    else this.positions.set(name, [this.names.length])
    this.names.push(name)
    if (name === 'svg' || name === 'math') this.foreignDepth += 1
  }

  /** Close the innermost element with this name, and everything nested inside it. */
  closeTag(name: string): void {
    const held = this.positions.get(name)
    this.truncateTo(held?.length ? held[held.length - 1] : this.names.length)
  }

  /** Drop every element above `depth`, for a block that ended with the container holding it. */
  truncateTo(depth: number): void {
    for (let position = this.names.length - 1; position >= depth; position -= 1) {
      const name = this.names[position]
      const held = this.positions.get(name)
      if (held) {
        held.pop()
        if (held.length === 0) this.positions.delete(name)
      }
      if (name === 'svg' || name === 'math') this.foreignDepth -= 1
    }
    this.names.length = depth
  }

  get depth(): number {
    return this.names.length
  }
}

function trackHtmlElements(line: string, stack: HtmlElementStack): void {
  // Scanned by hand, not by a regex: the tag's attributes alternate between quoted runs and
  // `[^>]`, and a tag that never closes makes those alternatives overlap — the backtracking an
  // engine spends on it grows exponentially in the number of quotes, which stalls the splitter
  // before the fallback has a chance to guard it. Each step here advances over one quote run or
  // one plain character, so a whole line costs one pass over it.
  for (const tag of eachHtmlTag(line)) {
    if (tag.closing) {
      stack.closeTag(tag.name)
      continue
    }
    // A raw name keeps the region contract its own tag shape sets: `<pre/>` is the type-7 tag the
    // parser reads plain, and holding an element open there would swallow the lines below it.
    const opens = tag.selfClosing
      ? !stack.isForeign(tag.name) && !HTML_RAW_TAGS.has(tag.name)
      : !VOID_HTML_ELEMENTS.has(tag.name)
    if (opens) stack.openTag(tag.name)
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

/** The markers a container prefix is built from, in the order the parser meets them. */
function containerMarkers(container: string): string[] {
  return [...container.matchAll(/[ \t]*(>|\d{1,9}[.)]|[-+*])/g)].map((match) => match[1])
}

/**
 * Whether the container on a definition-shaped line opens a block the paragraph above it does not
 * continue — a deeper quote, or a list marker, which opens a fresh item even at the same depth. A
 * marker that merely repeats the one the paragraph already sits behind does not: `> paragraph`
 * followed by `> [label]: /wrong` is one quoted paragraph, so the definition shape in it is prose.
 * Every marker in the chain counts, not only the last: `- > [label]: /url` opens an item ahead of
 * the quote, and that item ends the quoted paragraph above the definition.
 */
function containerOpensBlock(container: string, previous: string): boolean {
  const markers = containerMarkers(container)
  const previousMarkers = containerMarkers(previous)
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]
    const held = previousMarkers[index]
    if (marker === '>') {
      // A quote the paragraph above does not sit in opens a block where it stands.
      if (held !== '>') return true
      continue
    }
    // A list marker at a depth the quoted paragraph does not reach leaves the quote: the paragraph
    // inside it has no lazy continuation into a top-level item, so `> para` followed by
    // `2. [label]: /url` opens a list even though `2.` could not interrupt a paragraph.
    if (held === '>') return true
    // A list marker under a paragraph the item holds opens a block whatever it carries: a sibling
    // continues the list, while a marker of another number or kind closes the item's flow and the
    // parser reads the marker outside it, unbound by the interrupt rule — `2.` below a bullet item
    // opens an ordered list at any number, though it cannot interrupt a bare paragraph. Only below
    // a paragraph with no container of its own does the rule hold: `123.` there is prose the parser
    // keeps, so a definition shape inside it is not a definition.
    if (held !== undefined) return true
    return !/^\d/.test(marker) || Number.parseInt(marker, 10) === 1
  }
  return false
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
 * new block rather than continuing a paragraph: an ATX heading, a thematic break, or the underline
 * that makes an open paragraph above it a setext heading — prose where no paragraph precedes it.
 */
function isCompletedBlock(line: string, container: string | null, paragraphOpen: boolean): boolean {
  const content = container === null ? line : line.slice(container.length)
  // A quote marker with nothing behind it opens an empty block quote, which interrupts the
  // paragraph above it — so the line below starts a fresh block, not that paragraph's text.
  if (container !== null && isBlankLine(pastQuoteMarkers(line).content)) return true
  // An empty item opens a list only where no paragraph is open, and that list ends the block the
  // line stands in: without it the definition below reads as prose and a carried copy wins instead.
  if (!paragraphOpen && EMPTY_LIST_ITEM.test(content)) return true
  return ATX_HEADING.test(content) || (paragraphOpen && isSetextUnderline(line)) || THEMATIC_BREAK.test(line)
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

/**
 * Whether the text between an inline link's parentheses is what the parser reads as a destination,
 * with an optional title behind the whitespace that must separate them. `[a](not valid)` fails on
 * the space, so micromark renders the whole run as the text it was written as — a heading's id
 * keys on that text, and reading the run as a link would strip it.
 */
function inlineLinkTarget(content: string): boolean {
  if (/^[ \t]*$/.test(content)) return true
  const rest = pastDestination(content)
  if (rest === null) return false
  return /^[ \t]*$/.test(rest) || (/^[ \t]/.test(rest) && LINK_TITLE.test(rest))
}

/**
 * A run of one emphasis marker — the `*` in `# foo*bar*`, whose open/close class decides the text.
 * The marker is the run's whole class: micromark's attention tokenizer reads `*_` as the two runs
 * it is written as, and a run spanning both would key their pairing on the wrong flanks.
 */
const EMPHASIS_RUN = /^(\*+|_+)/

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
  // A run also opens against a marker beside it and closes behind one (`*` at `x*_y` opens and
  // closes): the two flags take the attention markers themselves, not only the class they fall in.
  // GFM registers `~` as an attention marker too (code point 126), so a `*` against a tilde opens
  // the way it does against another asterisk.
  const isMarker = (code: number): boolean => code === 42 || code === 95 || code === 126
  const open = right === undefined || (right === 'punctuation' && left !== undefined) || isMarker(after)
  const close = left === undefined || (left === 'punctuation' && right !== undefined) || isMarker(before)
  // The `!before`/`!after` tests above already cover whitespace, which classifies as its own group
  // here; micromark asks the same question of every non-punctuation neighbour, whitespace included.
  if (run[0] === '*') return { opens: open, closes: close }
  // `_` opens or closes only when the marker beside it is punctuation (or the run can do only
  // one of the two): a run between two word characters is the intraword underscore, plain text.
  return {
    opens: open && (left === 'punctuation' || !close),
    closes: close && (right === 'punctuation' || !open)
  }
}

/**
 * Where a scan resumes after the backtick run at `index`: past the span that a run of the same
 * length closes, or past the run itself when nothing closes it — an unmatched run is literal text
 * and the content behind it is parsed as such. Code span content is opaque, so a marker inside one
 * is not a marker at all.
 */
function afterBacktickRun(source: string, index: number): number {
  let opening = 1
  while (source[index + opening] === '`') opening += 1
  for (let next = index + opening; next < source.length;) {
    const at = source.indexOf('`', next)
    if (at < 0) break
    let end = at
    while (source[end] === '`') end += 1
    if (end - at === opening) return end
    next = end
  }
  return index + opening
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
    if (character === '`') {
      index = afterBacktickRun(source, index)
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
 * The emphasis markers `source` renders nothing for, keyed by the run's start with the number of
 * markers consumed. This follows micromark's own walk: a closing run searches back past openers the
 * rule of three rejects, takes two markers when both sides hold two and one otherwise, and consumes
 * every opener above the one it matched — those sit inside the new span and can no longer pair with
 * a later closer outside it.
 */
function emphasisSpans(source: string): Map<number, number> {
  const runs = emphasisRuns(source)
  const spans = new Map<number, number>()
  const open: Array<{ at: number; marker: string; remaining: number; closes: boolean }> = []
  // A closer pairs only with its own marker, so walking the other marker's openers is work with no
  // possible answer. `openers` indexes `open` per marker, and `bottoms` remembers, per class of
  // closer, where a failed search ran out: every opener below that was already rejected for the
  // same class, and a closer cannot make it acceptable again. Together they keep a document that
  // is all openers of one marker and closers of the other — the shape a heading of
  // `*a ` × 64k + `a_ ` × 64k takes — from costing its length squared.
  const openers = new Map<string, number[]>()
  const bottoms = new Map<string, number>()
  const trim = (length: number): void => {
    while (open.length > length) {
      const dropped = open.pop()
      if (!dropped) break
      const stack = openers.get(dropped.marker)
      if (stack && stack[stack.length - 1] === open.length) stack.pop()
    }
    for (const [key, bottom] of bottoms) if (bottom > open.length) bottoms.set(key, open.length)
  }
  for (const current of runs) {
    let remaining = current.run.length
    if (current.closes) {
      const stack = openers.get(current.run[0]) ?? []
      while (remaining > 0) {
        const key = `${current.run[0]}${remaining % 3}${current.opens ? 1 : 0}`
        const bottom = bottoms.get(key) ?? 0
        let match = -1
        for (let position = stack.length - 1; position >= 0; position -= 1) {
          const at = stack[position]
          if (at < bottom) break
          const candidate = open[at]
          // Rule of three: when the opener can also close or the closer can also open, a closer
          // that is not a multiple of three cannot pair when the two lengths sum to a multiple.
          if (
            (candidate.closes || current.opens) &&
            remaining % 3 !== 0 &&
            (candidate.remaining + remaining) % 3 === 0
          ) {
            continue
          }
          match = at
          break
        }
        if (match < 0) {
          bottoms.set(key, open.length)
          break
        }
        const opener = open[match]
        const use = opener.remaining > 1 && remaining > 1 ? 2 : 1
        spans.set(opener.at, (spans.get(opener.at) ?? 0) + use)
        spans.set(current.open, (spans.get(current.open) ?? 0) + use)
        opener.remaining -= use
        remaining -= use
        // Everything above the opener is inside the span just formed, so it stops opening.
        trim(opener.remaining === 0 ? match : match + 1)
        // A pairing moved an opener's length, and the rule of three reads lengths, so a rejection
        // remembered before it no longer decides anything.
        bottoms.clear()
      }
    }
    if (remaining > 0 && current.opens) {
      open.push({ at: current.open, marker: current.run[0], remaining, closes: current.closes })
      const stack = openers.get(current.run[0]) ?? []
      stack.push(open.length - 1)
      openers.set(current.run[0], stack)
    }
  }
  return spans
}

/** A run of tildes — the `~~` of `# foo~~bar~~baz`, whose pairing decides the text it renders. */
const TILDE_RUN = /^~+/

/** A run of equals signs — the `==` of `# foo==bar==baz`, whose pairing decides the text it renders. */
const EQUALS_RUN = /^=+/

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
    if (character === '`') {
      index = afterBacktickRun(source, index)
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
 * The `==` runs of `source` that the renderer reads as the markers of a highlight — which render no
 * text of their own. A highlight is an extension rather than core CommonMark, so it has no flank
 * tests of its own: it opens and closes on any run of two, pairing a closing run with the nearest
 * earlier one, and a run that pairs with nothing stays the text it was written as.
 */
function highlightSpans(source: string): Set<number> {
  const spans = new Set<number>()
  const open: number[] = []
  for (let index = 0; index < source.length;) {
    const character = source[index]
    if (character === '\\') {
      index += 2
      continue
    }
    if (character === '`') {
      index = afterBacktickRun(source, index)
      continue
    }
    if (character !== '=') {
      index += 1
      continue
    }
    const run = EQUALS_RUN.exec(source.slice(index))?.[0] ?? character
    const end = index + run.length
    if (run.length === 2) {
      const partner = open.length - 1
      if (partner >= 0) {
        spans.add(open[partner])
        spans.add(index)
        open.pop()
      } else {
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
const ENTITY_REFERENCE = /^&(#(?:\d{1,7}|[xX][\dA-Fa-f]{1,6})|[\dA-Za-z]{1,31});/

/**
 * The character a reference renders as, or null when the renderer leaves it as the literal text it
 * was written as — a name it does not know, or a number outside what a character can be.
 */
function decodeEntity(value: string): string | null {
  const numeric = /^#(?:[xX]([\dA-Fa-f]{1,6})|(\d{1,7}))$/.exec(value)
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
  // closes, a backslash escaping the character after it either way.
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
 * the renderer numbers an id from the same way it numbers a Markdown heading's. The opening and
 * closing tags are matched apart: pairing them in one regex made every unmatched `<h1` rescan the
 * rest of the block, which is quadratic on a block of them.
 */
const HTML_HEADING_CLOSE = /<\/h([1-6])\s*>/gi

/**
 * The offset of the `>` that closes the tag at `from`, or -1 when the tag never closes. A quoted
 * attribute value may hold a `>` that ends nothing, so only one outside a value closes the tag.
 * Every character is read once, which keeps a block of unterminated tags linear.
 */
function tagTerminator(content: string, from: number): number {
  let quote = ''
  let pendingValue = false
  for (let index = from; index < content.length; index += 1) {
    const character = content[index]
    if (quote !== '') {
      if (character === quote) quote = ''
    } else if (character === '=') {
      pendingValue = true
    } else if (pendingValue) {
      if (character !== ' ' && character !== '\t' && character !== '\n' && character !== '\r' && character !== '\f') {
        pendingValue = false
        if (character === '"' || character === "'") quote = character
      }
    } else if (character === '>') {
      return index
    }
  }
  return -1
}

/**
 * Opening heading tags, scanned linearly. Each candidate consumes up to its terminating `>`, so
 * a block of unterminated `<h1` opens walks the block once instead of rescanning it per candidate.
 */
function htmlHeadingOpens(content: string): Array<{ index: number; end: number; level: number }> {
  const opens: Array<{ index: number; end: number; level: number }> = []
  let cursor = 0
  while (cursor < content.length) {
    const start = content.indexOf('<', cursor)
    if (start === -1) break
    const next = content.charAt(start + 3)
    const isOpen =
      content.charAt(start + 1).toLowerCase() === 'h' &&
      content.charAt(start + 2) >= '1' &&
      content.charAt(start + 2) <= '6' &&
      (next === '' || next === '>' || next === ' ' || next === '\t' || next === '\n' || next === '\r' || next === '\f')
    if (!isOpen) {
      cursor = start + 1
      continue
    }
    // The tag ends at the first `>` outside an attribute value — a quoted value may hold one, and
    // ending there read the rest of the value as the heading's text.
    const close = tagTerminator(content, start + 3)
    // An unterminated value quote leaves the candidate open to the block's end, and nothing after
    // it can be terminated either, so the scan is over.
    if (close === -1) break
    opens.push({ index: start, end: close + 1, level: Number(content.charAt(start + 2)) })
    cursor = close + 1
  }
  return opens
}

/** The elements the sanitizer strips whole, content included. */
const RAW_TEXT_ELEMENTS = ['script', 'style'] as const

/** Whether the character at `index` leaves the tag name whole, as a word boundary requires. */
function endsTagName(lower: string, index: number): boolean {
  return !/\w/.test(lower.charAt(index))
}

/**
 * The offset past the first `</name\s*>` at or after `from`, or -1 when the block holds none.
 */
function rawTextCloseEnd(lower: string, name: string, from: number): number {
  const needle = `</${name}`
  for (let at = lower.indexOf(needle, from); at !== -1; at = lower.indexOf(needle, at + 1)) {
    let end = at + needle.length
    while (end < lower.length && /\s/.test(lower.charAt(end))) end += 1
    if (lower.charAt(end) === '>') return end + 1
  }
  return -1
}

/**
 * `content` with every tag stripped and a raw-text element (`script`, `style`) removed whole. One
 * pass over the block: the regex pair this replaced rescanned the rest of it for every unmatched
 * opener — 128,000 of them cost 18 s on a 1.15 MB heading — while each offset here is visited
 * once. An opener no closer follows loses only its own tag, and once no closer is left behind an
 * opener none can appear for a later one either.
 */
function stripHtmlTags(content: string): string {
  const lower = content.toLowerCase()
  // The offset past which each element's openers are known to have no closer behind them.
  const missingFrom = new Map<string, number>()
  let text = ''
  let copied = 0
  let cursor = 0
  while (cursor < content.length) {
    const open = content.indexOf('<', cursor)
    if (open === -1) break
    // A tag ends at the `>` outside its quoted values; no terminator behind this `<` means none
    // behind a later one either.
    const tagEnd = tagTerminator(content, open + 1)
    if (tagEnd === -1) break
    let rawEnd = -1
    for (const name of RAW_TEXT_ELEMENTS) {
      if (!lower.startsWith(`<${name}`, open) || !endsTagName(lower, open + name.length + 1)) continue
      const missing = missingFrom.get(name)
      if (missing !== undefined && missing <= tagEnd + 1) continue
      rawEnd = rawTextCloseEnd(lower, name, tagEnd + 1)
      if (rawEnd === -1) missingFrom.set(name, tagEnd + 1)
      break
    }
    text += content.slice(copied, open)
    copied = rawEnd === -1 ? tagEnd + 1 : rawEnd
    cursor = copied
  }
  return text + content.slice(copied)
}

/**
 * The text an HTML heading renders — its content with its own tags stripped and entities read. A
 * raw-text element the sanitizer strips (`script`, `style`) takes its content with it, so the text
 * it holds is no part of the id the renderer numbers.
 */
function htmlHeadingText(content: string): string {
  return stripHtmlTags(content).replace(
    /&(#(?:\d{1,7}|[xX][\dA-Fa-f]{1,6})|[\dA-Za-z]{1,31});/g,
    (entity, value: string) => decodeEntity(value) ?? entity
  )
}

/** CommonMark's escapable set: the ASCII punctuation a backslash is a valid escape before. */
const ASCII_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/

/** How far a backslash-delimited formula's closer is looked for; a lone opener costs this much. */
const MAX_INLINE_MATH_CHARS = 4_096

/**
 * The inline formula opening at `index`, with the text it renders as, or null when no formula opens
 * there. `remark-math` closes a `$` run on a run of its own length; `remarkLatexMath` reads
 * `\(…\)`, `\[…\]` and an environment the same way. A formula's source is not markdown.
 */
function inlineMathSpan(text: string, index: number): { text: string; end: number } | null {
  if (text[index] === '$') {
    let opening = 1
    while (text[index + opening] === '$') opening += 1
    for (let next = index + opening; next < text.length;) {
      const at = text.indexOf('$', next)
      if (at < 0) return null
      let end = at
      while (text[end] === '$') end += 1
      if (end - at === opening) return { text: text.slice(index + opening, at), end }
      next = end
    }
    return null
  }
  if (text[index] !== '\\') return null
  const marker = text[index + 1]
  const limit = Math.min(text.length, index + MAX_INLINE_MATH_CHARS)
  if (marker === '(' || marker === '[') {
    const open = marker
    const close = marker === '(' ? ')' : ']'
    let depth = 1
    for (let at = index + 2; at < limit; at += 1) {
      if (text[at] !== '\\') continue
      const next = text[at + 1]
      if (next === undefined) return null
      if (next === open) depth += 1
      else if (next === close && --depth === 0) return { text: text.slice(index + 2, at), end: at + 2 }
      at += 1
    }
    return null
  }
  // An environment opens only at a line head, past its indentation, as `remarkLatexMath` reads it.
  if (index > 3 || (index > 0 && text[index - 1] !== ' ' && text[index - 1] !== '\t')) return null
  const environment = /^\\begin\{([A-Za-z*]+)\}/.exec(text.slice(index, index + 32))
  if (!environment) return null
  const close = `\\end{${environment[1]}}`
  const end = text.indexOf(close, index + environment[0].length)
  if (end < 0 || end + close.length > limit) return null
  return { text: text.slice(index, end + close.length), end: end + close.length }
}

/**
 * The plain text a heading's inline source renders — the text the renderer numbers the heading's
 * id from. A link renders its label while its destination stays out of the text, an image with a
 * destination and a raw tag or comment render none at all, and an autolink renders its URL. What
 * survives is punctuation the slug's normalizer absorbs, so emphasis and code markers pass through
 * untouched and only the constructs that carry readable text need reading.
 *
 * @param source - The heading's inline source.
 * @param definesLabel - Whether the document defines a reference label. A reference it does not
 *   define is not a link: the whole construct stays literal text, brackets included.
 * @param footnoteNumber - The number the renderer gives a defined footnote reference, which its
 *   superscript renders; undefined for a reference the document does not define, which stays text.
 */
function headingRenderedText(
  source: string,
  definesLabel: (label: string) => boolean,
  footnoteNumber: (label: string) => number | undefined
): string {
  // Label content read so far, against the budget below.
  let labelChars = 0
  // A link's label is inline content of its own, so it is read by a recursive call. Inside a label
  // a `[` is literal, so the recursion is one level deep — and reading the rest of the segment in
  // place keeps the indexes built for it instead of rebuilding them once per link.
  const scanSegment = (segment: string, entryLabel: boolean): string => {
    let text = ''
    // No `>` after this offset means no tag can close there; scanning the suffix per `<` is what
    // made a line of unterminated `<style ` quadratic.
    const lastCloseAngle = segment.lastIndexOf('>')
    const lowerSegment = lastCloseAngle === -1 ? '' : segment.toLowerCase()
    // Positions the tag branch reads, built on first use so a segment without tags never pays.
    let tagPositions: { closeAngles: number[]; rawTextCloses: Map<string, number[]> } | null = null
    // `index` only moves forward, so a cursor per name stops repeated openers rescanning the
    // closers already passed. Reset with each segment because `index` is.
    const rawTextCursor = new Map<string, number>()
    const scanTagPositions = () => {
      if (tagPositions) return tagPositions
      const closeAngles: number[] = []
      for (let at = segment.indexOf('>'); at !== -1; at = segment.indexOf('>', at + 1)) closeAngles.push(at)
      const rawTextCloses = new Map<string, number[]>()
      for (const name of ['script', 'style']) {
        const closes: number[] = []
        for (let at = lowerSegment.indexOf(`</${name}`); at !== -1; at = lowerSegment.indexOf(`</${name}`, at + 1)) {
          closes.push(at)
        }
        rawTextCloses.set(name, closes)
      }
      tagPositions = { closeAngles, rawTextCloses }
      return tagPositions
    }
    const firstCloseAngleAtOrAfter = (from: number): number => {
      const { closeAngles } = scanTagPositions()
      let low = 0
      let high = closeAngles.length
      while (low < high) {
        const mid = (low + high) >> 1
        if (closeAngles[mid] < from) low = mid + 1
        else high = mid
      }
      return low < closeAngles.length ? closeAngles[low] : -1
    }
    // A label is inline content of its own, so its emphasis pairs within it rather than across the
    // link that holds it. Matched on first use, so a segment with no emphasis never pays the scan.
    let spans: Map<number, number> | null = null
    // The strikethrough markers, matched the same way on their own first use.
    let strikes: Set<number> | null = null
    // The highlight markers, matched the same way on their own first use.
    let highlights: Set<number> | null = null
    // Where the bracket each `[` opens closes, matched in one forward walk: a backslash escapes the
    // character after it and a `]` closes the nearest bracket still open. Built on first use, so a
    // segment without brackets never pays, and a run no bracket closes is answered in constant time
    // rather than rescanned from every bracket inside it.
    let bracketCloses: Map<number, number> | null = null
    const bracketRun = (open: number): { end: number; closed: boolean } => {
      if (!bracketCloses) {
        bracketCloses = new Map()
        const stack: number[] = []
        for (let at = 0; at < segment.length; at += 1) {
          const character = segment[at]
          if (character === '\\') at += 1
          else if (character === '[') stack.push(at)
          else if (character === ']' && stack.length > 0) bracketCloses.set(stack.pop() as number, at)
        }
      }
      const close = bracketCloses.get(open)
      return close === undefined ? { end: segment.length, closed: false } : { end: close + 1, closed: true }
    }
    let index = 0
    while (index < segment.length) {
      const character = segment[index]
      // The renderer prints a formula's own source as text and drops its delimiters.
      const formula = character === '$' || character === '\\' ? inlineMathSpan(segment, index) : null
      if (formula) {
        text += formula.text
        index = formula.end
      } else if (character === '\\') {
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
        // A code span's content is literal, and only a run of the opener's own length closes it —
        // a longer run inside the span is content, so the scan continues past it.
        let opening = 1
        while (segment[index + opening] === '`') opening += 1
        const run = '`'.repeat(opening)
        let close = -1
        for (let next = index + opening; next < segment.length;) {
          const at = segment.indexOf('`', next)
          if (at < 0) break
          let end = at
          while (segment[end] === '`') end += 1
          if (end - at === opening) {
            close = at
            break
          }
          next = end
        }
        const closed = close >= 0
        // The renderer drops one space or line ending from each end of a closed code span that
        // carries both, so `` ` bar ` `` renders `bar` — the slug has to read the same text.
        let content = segment.slice(index + run.length, closed ? close : index + run.length)
        if (closed && content.length > 2 && /^[ \n]/.test(content) && /[ \n]$/.test(content) && content.trim() !== '')
          content = content.slice(1, -1)
        text += content
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
        // A `<` with no `>` behind it cannot open a tag, so it is the text it was written as.
        if (index > lastCloseAngle) {
          text += character
          index += 1
          continue
        }
        // Every tag this branch reads is bounded: a window this wide cannot hold a tag a heading
        // renders, and slicing the whole suffix per `<` is what made a run of them quadratic.
        const rest = segment.slice(index, Math.min(segment.length, index + MAX_TAG_WINDOW))
        // A raw-text element the sanitizer strips keeps none of the text it holds — `A<style>x</style>B`
        // renders `AB`, and a heading id keyed on `axb` would take the id a later `# AB` should get.
        // Its open and close are located by position rather than scanned per candidate.
        const rawTextOpen = /^<(script|style)(?=[\s/>])/i.exec(rest)
        if (rawTextOpen) {
          const name = rawTextOpen[1].toLowerCase()
          const { rawTextCloses } = scanTagPositions()
          const closes = rawTextCloses.get(name) ?? []
          const afterOpen = index + rawTextOpen[0].length
          let cursor = rawTextCursor.get(name) ?? 0
          while (cursor < closes.length && closes[cursor] <= afterOpen) cursor += 1
          rawTextCursor.set(name, cursor)
          const closeAt = cursor < closes.length ? closes[cursor] : -1
          if (closeAt !== -1) {
            const openEnd = firstCloseAngleAtOrAfter(afterOpen)
            if (openEnd !== -1 && openEnd < closeAt && openEnd - index <= MAX_TAG_WINDOW) {
              const closeEnd = firstCloseAngleAtOrAfter(closeAt + name.length + 2)
              if (closeEnd !== -1 && /^[ \t\n\r\f]*$/.test(segment.slice(closeAt + name.length + 2, closeEnd))) {
                index = closeEnd + 1
                continue
              }
            }
          }
        }
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
        // Only the markers a partner consumed render nothing; any leftover stays the text it was.
        const consumed = (spans ??= emphasisSpans(segment)).get(index) ?? 0
        if (consumed < run.length) text += run.slice(consumed)
        index += run.length
      } else if (character === '~') {
        const run = TILDE_RUN.exec(segment.slice(index))?.[0] ?? character
        // The same for a strikethrough: only the run that found its partner renders nothing.
        if (!(strikes ??= strikethroughSpans(segment)).has(index)) text += run
        index += run.length
      } else if (character === '=') {
        const run = EQUALS_RUN.exec(segment.slice(index))?.[0] ?? character
        // The same for a highlight: `==bar==` renders `bar`, so the markers are no part of the text
        // the slug is numbered from — without this the heading keys on `foo-bar-baz` while the
        // renderer keys `foobarbaz`, and a later duplicate takes the id a link resolves to.
        if (!(highlights ??= highlightSpans(segment)).has(index)) text += run
        index += run.length
      } else if (character === '[' && segment[index + 1] === '^') {
        const reference = /^\[\^([^[\]\s]+)\]/.exec(segment.slice(index))
        const number = reference ? footnoteNumber(reference[1]) : undefined
        // A defined footnote reference renders its number as a superscript; one the document never
        // defines is not a reference and keeps its brackets as text, exactly as the renderer prints it.
        if (reference && number !== undefined) {
          text += String(number)
          index += reference[0].length
        } else {
          text += character
          index += 1
        }
      } else if ((character === '[' && !entryLabel) || (character === '!' && segment[index + 1] === '[')) {
        const open = index + (character === '!' ? 1 : 0)
        const label = bracketRun(open)
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
        // A destination or reference follows only a label that closed; otherwise the scan already
        // read to the end of the segment, and the run cannot be part of a construct at all. One
        // that never closes reads that far again, so the run behind the label is charged the tail
        // it cost too — a heading of `[a](` repeated paid it from every bracket in turn.
        const reference = segment[label.end] === '[' ? bracketRun(label.end) : { end: label.end, closed: true }
        const follow = label.closed
          ? segment[label.end] === '('
            ? pastParenRun(segment, label.end)
            : reference.closed
              ? reference.end
              : -1
          : -1
        labelChars += (follow >= label.end ? follow : segment.length) - label.end
        const nested = label.closed && holdsLink(segment.slice(open + 1, label.end - 1))
        // An inline link's destination has to be one the parser reads: `[Alpha](not valid)` is no
        // link at all, so the run stays the literal text the heading renders — reading it as a link
        // would strip text the renderer keeps and take the id a later heading should get.
        const malformed =
          label.closed &&
          segment[label.end] === '(' &&
          follow >= label.end &&
          !inlineLinkTarget(segment.slice(label.end + 1, follow - 1))
        // A reference is a link only where the document defines its label: `[text][ref]`,
        // `[text][]` and `[text]` all degrade to literal text without one, brackets included, and
        // the slug the renderer numbers comes from that literal text. An inline `[text](dest)` is a
        // link whatever the document holds, so only the reference forms consult it.
        const referenceLabel =
          segment[label.end] === '['
            ? segment.slice(label.end + 1, reference.end - 1) || segment.slice(open + 1, label.end - 1)
            : segment.slice(open + 1, label.end - 1)
        const unresolved =
          label.closed && segment[label.end] !== '(' && !definesLabel(normalizeReferenceLabel(referenceLabel))
        if (unresolved) {
          // The brackets stay literal text while the content inside them stays inline content the
          // parser reads as such — `[A &amp; B]` renders with the entity decoded — so the scan
          // moves one character and reads the run where it stands, the closing bracket and the
          // reference behind it included as the text they are.
          text += character
          index += 1
        } else if (malformed) {
          // The bracket is text the parser left standing; the link a label inside it writes may
          // still be one, so the scan moves one character and reads from the bracket after it.
          text += character
          index += 1
        } else if (label.closed && !nested && follow >= label.end) {
          // A link renders its label; an image renders none — a shortcut image whose label the
          // document defines has a destination just like `![alt](src)`, so its label is text the
          // renderer never shows. An image the document defines nothing for is the literal text
          // above, never this branch. A label cannot hold a link, so reading it is one level deep.
          if (character !== '!') {
            // The label renders where the link stands, and the rest of the segment is read on in
            // place — so this segment's bracket and emphasis indexes are never rebuilt per link.
            text += scanSegment(segment.slice(open + 1, label.end - 1), true)
          }
          index = follow
        } else if (nested) {
          text += character
          index += 1
        } else {
          // A bracket that opens a run no later bracket closes is text the parser keeps, and what
          // follows it is still inline content it reads — `[A &amp; B` renders `[A & B` — so only
          // the bracket is appended and the rest is read where it stands. `bracketRun` answers
          // the run in constant time, so the line is not scanned once per bracket in turn.
          text += character
          index += 1
        }
      } else {
        text += character
        index += 1
      }
    }
    return text
  }
  return scanSegment(source, false)
}

/** A footnote reference's label: no whitespace and no bracket of either kind, inside `[^…]`. */
const FOOTNOTE_REFERENCE = /\[\^([^[\]\s]+)\]/y

/**
 * The footnote references a line of body text carries, in the order they appear — the order the
 * renderer numbers the notes in. An escaped bracket is text, and a code span's content is literal,
 * so neither opens a reference.
 */
function footnoteReferences(text: string): string[] {
  const labels: string[] = []
  let index = 0
  while (index < text.length) {
    const character = text[index]
    // A formula's source is no markdown, so a reference written inside one is not a note.
    const formula = character === '$' || character === '\\' ? inlineMathSpan(text, index) : null
    if (formula) {
      index = formula.end
      continue
    }
    if (character === '\\') {
      index += 2
      continue
    }
    if (character === '`') {
      let run = 1
      while (text[index + run] === '`') run += 1
      // Only a run of the opener's own length closes the span; a longer one is content, and the
      // walk resumes past it.
      let closed = -1
      for (let next = index + run; next < text.length;) {
        const open = text.indexOf('`', next)
        if (open < 0) break
        let at = open
        while (text[at] === '`') at += 1
        if (at - open === run) {
          closed = at
          break
        }
        next = at
      }
      index = closed < 0 ? index + run : closed
      continue
    }
    if (character === '[' && text[index + 1] === '^') {
      FOOTNOTE_REFERENCE.lastIndex = index
      const match = FOOTNOTE_REFERENCE.exec(text)
      if (match) {
        labels.push(match[1].toLowerCase())
        index += match[0].length
        continue
      }
    }
    index += 1
  }
  return labels
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
): { text: string; label: string; tail: string; lines: number } | null {
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
      const label = labelLines.join('\n')
      // The single-line path above rejects a label of whitespace alone; the wrapped path must too,
      // or `[]: /url` — a label the parser refuses — rides as a definition and the prose the line
      // belongs to prints it a second time.
      if (!/[^\s]/.test(label)) return null
      return {
        // The label is carried the way it was written, line endings included — the parser reads
        // and normalizes it whole again wherever the definition lands.
        text: `[${label}]:${after[1]}${after[2]}`,
        label: label,
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

function linkDefinition(
  lines: string[],
  index: number,
  sourceLine: string = lines[index]
): { text: string; label: string; lines: number } | null {
  const start = DEFINITION_CONTAINER.exec(sourceLine)
  // A first marker indented four columns or more — a tab counts as up to four — opens indented
  // code, not a container, so no definition opens behind it.
  if (start && leadingColumns(sourceLine) >= 4) return null
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
  const definitionSource = start ? sourceLine.slice(start[0].length) : sourceLine.replace(/^ {1,3}(?=\[)/, '')
  const label = LINK_DEFINITION_LABEL.exec(definitionSource)
  let body: string[]
  let tail: string
  let span: number
  let definitionLabel: string
  if (label) {
    // A label the parser would refuse — one of whitespace alone, or one longer than the 999
    // characters it allows — leaves the line a paragraph. The count is over the label as written,
    // escapes included, rather than over the text those escapes resolve to.
    if (!/[^\s]/.test(label[1]) || label[1].length > MAX_LABEL_SOURCE_CHARS) return null
    body = [`[${label[1]}]:${label[2]}${label[3]}`]
    tail = label[3]
    span = 1
    definitionLabel = label[1]
  } else {
    const wrapped = wrappedLinkLabel(lines, index, definitionSource, { quotes, quoteColumns, labelColumn })
    if (!wrapped) return null
    body = [wrapped.text]
    tail = wrapped.tail
    span = wrapped.lines
    definitionLabel = wrapped.label
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
  } else if (/^[ \t]/.test(tail) && (LINK_TITLE.test(tail) || LINK_TITLE_OPEN.test(tail))) {
    // The parser reads a title on the destination's own line only behind whitespace; without one
    // the whole line is a paragraph, and a title shape taken here hoisted that paragraph.
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
  return { text: body.join('\n'), label: definitionLabel, lines: span }
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
  // The captured name is a literal delimiter, so its `*` has to stay one: interpolated raw it
  // would be a quantifier, and the close of a starred environment would never match.
  const name = environment?.[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const run: MathRun = environment
    ? {
        open: new RegExp(`^\\\\begin\\{${name}\\}`),
        close: new RegExp(`^\\\\end\\{${name}\\}`),
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
  /** The column the item's content starts at — where a line has to sit to stay inside the item. */
  content: number
}

/**
 * The column a list item's content starts at: past its marker, its indent and the separator behind
 * it. A separator wider than the parser allows leaves the content one column past the marker.
 */
function itemContentColumn(line: string, item: RegExpExecArray): number {
  const separator = /^[ \t]*/.exec(line.slice(item[0].length))?.[0] ?? ''
  const markerEnd = columnCount(line.slice(0, item[0].length))
  const content = columnCount(line.slice(0, item[0].length + separator.length))
  return content - markerEnd > 4 ? markerEnd + 1 : content
}

function trackListItem(run: ListRun | null, item: RegExpExecArray, line: string): ListRun {
  const [, indent, bullet, , delimiter] = item
  // A deeper marker belongs to a nested list, which the run above it already spans.
  if (run && indent.length > run.indent.length) return run
  return { indent, marker: bullet ?? delimiter, content: itemContentColumn(line, item) }
}

/** Whether a line is indented into the item `run` holds open, so a blank line above it spans it. */
function continuesListItem(line: string, run: ListRun | null): boolean {
  const columns = leadingColumns(line)
  return columns > 0 && run !== null && columns >= run.content
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
  // The pathological shape is decided before any heading is read: this document falls back to the
  // source view, where no heading id renders, and the heading scan is what those lines make slow.
  let terminatorChars = 0
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i)
    if (code === 10 || code === 13) terminatorChars += 1
  }
  const longLines = isPathologicalLineShape(lineCount, content.length - terminatorChars)
  // The next line with content on it, so a run of blank lines belongs to the block that spans it.
  const nextContent = new Array<number>(lines.length).fill(-1)
  for (let i = lines.length - 2, next = -1; i >= 0; i--) {
    if (!isBlankLine(lines[i + 1])) next = i + 1
    nextContent[i] = next
  }

  const definitions: string[] = []
  // The index in `definitions` each definition opens at, so a carried footnote's continuation lines
  // stay one block while separate definitions are given the blank line the parser needs between them.
  const definitionBlocks: number[] = []
  // A definition may cover up to three source lines while occupying one entry here, so the carried
  // prefix is measured in lines rather than entries — the virtualizer estimates from this count.
  let definitionLines = 0
  const boundaries: number[] = []
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
  const htmlOpenElements = new HtmlElementStack()
  // The stack's height when the open block began, so the elements it opened can be given back when
  // the container it was written behind ends with it.
  let htmlBlockElementBase = 0
  let inDefinition = false
  let footnoteDefinition = false
  let run: ListRun | null = null
  // The content column of a top-level empty item on the line just walked, so the line below it —
  // the item's only content — can be read from the column the item starts at.
  let pendingEmptyItem: number | null = null
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
  // The lines still owed to a definition the note's content opened — its label or destination may
  // wrap onto them — during which no paragraph of the note's own is open.
  let nestedDefinitionLines = 0
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
  // line may render more than one heading, so each holds every occurrence in document order. The
  // heading's inline source is recorded here and its slug is assigned below, once the whole
  // document's definitions are known: a reference the document never defines is literal text, and
  // whether one is defined can only be settled after the last line has been read.
  const lineHeadings = new Array<Array<{ source: string; plain: boolean }> | undefined>(lines.length).fill(undefined)
  const recordHeading = (line: number, source: string, plain = false): void => {
    if (longLines) return
    ;(lineHeadings[line] ??= []).push({ source, plain })
  }
  // Every reference label the document defines, in the form references are matched by. A heading
  // may sit above the definition it references, so the set is only complete once the walk ends.
  const definedLabels = new Set<string>()
  // The footnote labels the document defines, and the body references it carries in document order:
  // the renderer numbers each note by its first reference, so a heading that holds one renders that
  // number as text and its id can only be keyed once both are known.
  const definedFootnotes = new Set<string>()
  const footnoteOrder: string[] = []
  // The references each body line carries, as this context-aware walk reads them: a chunk numbers
  // its notes from these rather than rescanning lines the renderer never reads.
  const lineFootnoteRefs = new Array<string[] | undefined>(lines.length)
  // A raw HTML block's lines are the tags the renderer parses into elements, so a complete heading
  // tag anywhere in the block numbers the document's ids the same way an ATX heading does — one a
  // single line may hold several of. The block is scanned whole, since its tag, text and closing
  // tag may sit on different lines.
  const recordHtmlHeadings = (line: number, content: string): void => {
    if (longLines) return
    // Closing tags are indexed once, so an opening tag with no partner behind it costs a lookup
    // rather than a rescan of the block — a block of unmatched `<h1` tags is what makes that
    // difference.
    const closings = new Map<number, Array<{ start: number; end: number }>>()
    for (const close of content.matchAll(HTML_HEADING_CLOSE)) {
      const level = Number(close[1])
      const held = closings.get(level)
      if (held) held.push({ start: close.index, end: close.index + close[0].length })
      else closings.set(level, [{ start: close.index, end: close.index + close[0].length }])
    }
    // Each level's closings are consumed in order, so one cursor per level walks them once.
    const cursors = new Map<number, number>()
    let resume = 0
    for (const open of htmlHeadingOpens(content)) {
      if (open.index < resume) continue
      const start = open.end
      const level = open.level
      const held = closings.get(level)
      if (!held) continue
      let at = cursors.get(level) ?? 0
      while (at < held.length && held[at].start < start) at += 1
      cursors.set(level, at)
      if (at >= held.length) continue
      const partner = held[at]
      // `htmlHeadingText` already reads the tag's content the way the renderer does, so this entry
      // needs no inline scan of its own.
      recordHeading(line, htmlHeadingText(content.slice(start, partner.start)), true)
      resume = partner.end
    }
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

  /**
   * The definition a line of a footnote's content opens, or null when it opens none. The line is
   * passed as the parser reads it inside the note — already past the note's own columns — and the
   * lines below join it as far as they stay the note's: a definition's label or destination may
   * wrap there the way it does at the top level. One that needs a line past that stretch, or past
   * the window below, fails — the conservative read.
   */
  const nestedDefinitionAt = (held: string, from: number): { label: string; lines: number } | null => {
    if (FOOTNOTE_DEFINITION_START.test(held)) return null
    const projected = [held]
    for (let ahead = 1; ahead <= 4 && from + ahead < lines.length; ahead += 1) {
      const next = activeDefinitionContainer
        ? stripDefinitionContainer(lines[from + ahead], activeDefinitionContainer)
        : lines[from + ahead]
      // A blank, a line outside the note's container, or one that opens a block of its own ends
      // the stretch a definition may span; anything else continues the note's paragraph lazily.
      if (next === null || !/\S/.test(next) || endsLazyParagraph(next)) break
      projected.push(afterColumns(4, next))
    }
    return linkDefinition(projected, 0)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const blank = isBlankLine(line)
    // The item above belongs to the line immediately below it: a blank between them ends the item,
    // and the indented line after it is code the parser reads at the top level.
    const emptyItemColumn = pendingEmptyItem
    pendingEmptyItem = null
    bufferChars += line.length + 1

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
      if (htmlBlockContainer !== null || stripped === null) htmlOpenElements.truncateTo(htmlBlockElementBase)
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
      const step = containerFenceStep(line, containerFence)
      if (step === 'end') {
        containerFence = null
      } else {
        if (step === 'close') containerFence = null
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
      if (item) run = trackListItem(run, item, line)
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
      htmlBlockElementBase = htmlOpenElements.depth
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
    const indentedContinuation = definitionContainer
      ? insideContainer !== null &&
        // A marker-only line behind the definition's container (`>` on its own) is blank the way
        // the parser sees it: the quote reproduces the line and the definition spans it.
        (isBlankLine(insideContainer) ||
          (INDENTED_LINE.test(insideContainer) && !startsBlock(insideContainer) && !sawBlankInDefinition) ||
          // Past a blank line the definition owns only lines the parser counts as indented to four
          // columns inside the container — `>  second` behind a `>` quote carries two, so it is a
          // quoted paragraph of its own and carrying it would print it in every chunk.
          (sawBlankInDefinition && continuesDefinitionAfterBlank(insideContainer) && !startsBlock(insideContainer)) ||
          (blank && continuesDefinitionAfterBlank(strippedNextContent(lines, nextContent, i, definitionContainer))))
      : indentedCode || (blank && continuesDefinitionAfterBlank(lines[nextContent[i]]))
    // A blank line the definition spans — a bare one, or the definition's own container markers on
    // a line of their own (`>`), which is blank the way the parser sees it — ends no container, so
    // it has to be remembered for the continuation line that follows it. Either kind ends the
    // paragraph a lazy line below would continue.
    if (blank && inDefinition && footnoteDefinition) footnoteParagraphOpen = false
    if (definitionContainer && insideContainer !== null && (blank || isBlankLine(insideContainer))) {
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
      const stripped =
        activeDefinitionContainer && !blank ? stripDefinitionContainer(line, activeDefinitionContainer) : line
      // A line short of the container is a lazy paragraph continuation: it carries the content
      // read past the markers, never the markers themselves.
      const carried = stripped ?? footnoteLazyContent ?? line
      // A quoted definition's blank marker line carries as a plain blank line: the parser reads
      // the definition's paragraphs across it, and `>` alone would start a quote block of its own.
      definitions.push(isBlankLine(carried) ? '' : carried)
      definitionLines += 1
      // The note's lines are block content the parser reads inside it, so a definition one of them
      // opens defines its label for the whole document — the carried copy renders in every chunk,
      // and only the scan's own label lookup needs it here. A definition the note's open paragraph
      // spans cannot open at all, and the body lines of one that did leave no paragraph open.
      let inNestedDefinition = false
      if (nestedDefinitionLines > 0) {
        nestedDefinitionLines -= 1
        inNestedDefinition = true
      } else if (indentedContinuation && !isBlankLine(carried) && !footnoteParagraphOpen) {
        const nested = nestedDefinitionAt(afterColumns(4, carried), i)
        if (nested) {
          definedLabels.add(normalizeReferenceLabel(nested.label))
          inNestedDefinition = true
          nestedDefinitionLines = nested.lines - 1
        }
      }
      if (!isBlankLine(carried))
        footnoteParagraphOpen = inNestedDefinition ? false : continuesFootnoteParagraph(carried)
      continue
    }
    // A footnote definition cannot interrupt a paragraph either, and the container in front of it
    // only counts where it opens a block: `2) [^r]: right` below a paragraph is that paragraph's
    // text, so hoisting it would print a note the unsplit document does not have.
    const opensBlock = container !== null && containerOpensBlock(container[0], paragraphContainer ?? '')
    const footnoteStart =
      containerHoldsCode || (container !== null && previousStatus === 'paragraph' && !opensBlock)
        ? null
        : FOOTNOTE_DEFINITION_START.exec(uncontained)
    if (footnoteStart) {
      definedFootnotes.add(footnoteStart[1].toLowerCase())
      definitionBlocks.push(definitions.length)
      definitions.push(uncontained)
      definitionLines += 1
      inDefinition = true
      footnoteDefinition = true
      sawBlankInDefinition = false
      // The definition keeps the container it was written behind: its continuation lines must
      // lose that container the same way the opening line did, or the carried prefix holds only
      // the first line and a truncated copy shadows the complete definition.
      activeDefinitionContainer = container ? containerParams(container[0]) : null
      // The note's own first line holds content too, read the way its carried text parses: a
      // definition written behind the label defines its label for the whole document the same way.
      const opening = nestedDefinitionAt(footnoteStart[2].replace(/^[ \t]+/, ''), i)
      if (opening) {
        definedLabels.add(normalizeReferenceLabel(opening.label))
        nestedDefinitionLines = opening.lines - 1
        footnoteParagraphOpen = false
      } else {
        footnoteParagraphOpen = continuesFootnoteParagraph(footnoteStart[2])
      }
      // A definition written as a list item still numbers that list, so the blank line behind it
      // may not end one — the same reason an ordinary item keeps the run alive.
      const item = LIST_ITEM.exec(line)
      if (item) run = trackListItem(run, item, line)
      previousStatus = 'block'
      paragraphContainer = null
      continue
    }
    // A link definition cannot interrupt a paragraph: a definition-shaped line under an open
    // paragraph is paragraph text, and hoisting it would shadow the real definition. A container
    // opener that breaks that paragraph — a deeper quote, or a list marker, which opens a fresh
    // item — leaves the definition standing behind it.
    // An empty item's content sits on the line below it, at the item's own column: `-` then
    // `    [label]: /url` is a definition inside the item, not the top-level indented code it looks like.
    // A loose item's later paragraphs read the same way: the blank the item spans holds the
    // boundary, so a definition-shaped line indented into the open item is the item's content —
    // four columns past the item whose content starts at three — and not the top-level indented
    // code its indent alone would suggest. Past four columns the parser reads indented code again,
    // and one to three columns short of the item leave the line outside it.
    const inOpenItem =
      run !== null && !blank && leadingColumns(line) >= run.content && leadingColumns(line) < run.content + 4
    const itemSource =
      emptyItemColumn !== null &&
      !blank &&
      leadingColumns(line) >= emptyItemColumn &&
      leadingColumns(line) < emptyItemColumn + 4
        ? afterColumns(emptyItemColumn, line)
        : inOpenItem
          ? afterColumns(run.content, line)
          : undefined
    const definition =
      (previousStatus === 'paragraph' && !opensBlock) || containerHoldsCode
        ? null
        : linkDefinition(lines, i, itemSource)
    if (definition) {
      definitionBlocks.push(definitions.length)
      definitions.push(definition.text)
      definedLabels.add(normalizeReferenceLabel(definition.label))
      definitionLines += definition.lines
      bufferChars += definition.text.length + 1
      i += definition.lines - 1
      inDefinition = false
      activeDefinitionContainer = null
      const item = LIST_ITEM.exec(line)
      if (item) run = trackListItem(run, item, line)
      previousStatus = 'block'
      paragraphContainer = null
      continue
    }
    inDefinition = false
    // The renderer numbers the document's footnotes in the order the body first references them —
    // a definition's own content is written after the body — so each reference a body line carries
    // is recorded here, and the numbers are handed out once every definition is known.
    for (const label of footnoteReferences(uncontained)) {
      footnoteOrder.push(label)
      ;(lineFootnoteRefs[i] ??= []).push(label)
    }
    // Heading ids are numbered over the whole document, so a heading is recorded where it renders:
    // an ATX heading where it stands, a setext one on the paragraph its underline turns into one —
    // which the parser reads whole, line after line.
    if (!blank && !containerHoldsCode) {
      const atx = ATX_HEADING.exec(uncontained)
      if (atx) {
        recordHeading(i, atx[1] ?? '')
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
          recordHeading(paragraphStart, text)
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
      const paragraphOpen = previousStatus === 'paragraph'
      if (!paragraphOpen || opensBlock) paragraphStart = i
      // Indented code is a block of its own, so the line under it starts from no open paragraph —
      // which is what lets the definition there stand instead of reading as paragraph text.
      const status =
        indentedCode || isCompletedBlock(line, container?.[0] ?? null, paragraphOpen) ? 'block' : 'paragraph'
      // A line that falls short of the container holding the open paragraph continues it lazily,
      // and the paragraph stays inside that container: the markers below it repeat the paragraph's
      // rather than open a block, so a definition shape there is still that paragraph's prose.
      const lazy =
        paragraphOpen &&
        status === 'paragraph' &&
        !opensBlock &&
        paragraphContainer !== null &&
        stripDefinitionContainer(line, containerParams(paragraphContainer)) === null
      if (!lazy) paragraphContainer = container?.[0] ?? null
      previousStatus = status
    }

    // A thematic break carries an item marker at its head but is a block of its own.
    const item = THEMATIC_BREAK.test(line) ? null : LIST_ITEM.exec(line)
    if (item) {
      run = trackListItem(run, item, line)
      pendingEmptyItem = item[1] === '' && EMPTY_LIST_ITEM.test(line) ? itemContentColumn(line, item) : null
      continue
    }
    if (TOP_LEVEL_BLOCK_START.test(line)) run = null

    // A blank line ends the current block, so it is the only place a chunk may safely end.
    if (!blank) continue
    const followedBy = nextContent[i]
    // The blank sits inside the block above it only where the line below continues that block:
    // four columns of indented code, which the blank line does not end, or a list item's content,
    // which the line is indented into. A paragraph merely written a column or three in is a block
    // of its own, and holding the boundary there left a whole document one oversized chunk.
    if (followedBy >= 0 && (leadingColumns(lines[followedBy]) >= 4 || continuesListItem(lines[followedBy], run)))
      continue
    // The paragraph the blank follows is the term of a description the next line opens — the
    // renderer reads the two as one construct across the blank, and cut there the description
    // renders the plain paragraph it is only without its term.
    if (
      i > 0 &&
      !isBlankLine(lines[i - 1]) &&
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
    if (bufferChars >= budgetChars && htmlOpenElements.depth === 0) {
      boundaries.push(i + 1)
      bufferChars = 0
    }
  }
  // A block still open at the end of the document closes here, its headings counted with the rest.
  if (htmlBlankBlock) closeHtmlBlock()

  // Every definition the walk found is now known, so each heading's text can be read the way the
  // renderer reads it and the document's ids numbered in the order the headings stand.
  const definesLabel = (label: string): boolean => definedLabels.has(label)
  // A note is numbered by the first body reference that resolves to it; a reference to a label the
  // document never defines stays literal text, so it takes no number.
  const footnoteNumbers = new Map<string, number>()
  for (const label of footnoteOrder) {
    if (!definedFootnotes.has(label) || footnoteNumbers.has(label)) continue
    footnoteNumbers.set(label, footnoteNumbers.size + 1)
  }
  const footnoteNumber = (label: string): number | undefined => footnoteNumbers.get(label.toLowerCase())
  const slugOrder = new Map<string, string[]>()
  // Each occurrence keeps its source beside the document-wide slug: the chunk's own lookup key is
  // read again below, because a chunk numbers its footnotes only from the references it carries.
  const lineSlugs = new Array<{ source: string; plain: boolean; slug: string }[] | undefined>(lines.length)
  for (let i = 0; i < lines.length; i++) {
    for (const heading of lineHeadings[i] ?? []) {
      const base = normalizeHeadingText(
        heading.plain ? heading.source : headingRenderedText(heading.source, definesLabel, footnoteNumber)
      )
      const seen = slugOrder.get(base) ?? []
      const slug = seen.length === 0 ? base : `${base}-${seen.length}`
      seen.push(slug)
      slugOrder.set(base, seen)
      ;(lineSlugs[i] ??= []).push({ source: heading.source, plain: heading.plain, slug })
    }
  }

  // A blank line between definitions keeps a footnote's lazy continuation from swallowing the
  // definition below it; the empty comment ends the last one so the body's indented lines stay code.
  const definitionText = definitionBlocks
    .map((start, index) => definitions.slice(start, definitionBlocks[index + 1] ?? definitions.length).join('\n'))
    .join('\n\n')
  const prefix = definitionBlocks.length > 0 ? `${definitionText}\n\n<!---->\n\n` : ''
  const prefixLines = definitionBlocks.length > 0 ? definitionLines + (definitionBlocks.length - 1) + 3 : 0
  const chunks: MarkdownChunk[] = []
  let start = 0
  for (const end of [...boundaries, lines.length]) {
    if (end <= start) continue
    // A chunk renders on its own, so its footnotes are numbered from the references it carries —
    // the hoisted definitions' own references are read last — while the slugs stay document-wide.
    const localFootnotes = new Map<string, number>()
    const localFootnoteNumber = (label: string): number | undefined => localFootnotes.get(label.toLowerCase())
    const chunkSlugs = new Map<string, string[]>()
    for (let i = start; i < end; i++) {
      // The walk's own events: it already dropped the lines that are not body text — fenced code,
      // raw HTML, display math — and a definition's label is no reference there either. A label the
      // document never defines stays literal text and takes no number, as it takes none above.
      for (const label of lineFootnoteRefs[i] ?? [])
        if (definedFootnotes.has(label) && !localFootnotes.has(label))
          localFootnotes.set(label, localFootnotes.size + 1)
      for (const heading of lineSlugs[i] ?? []) {
        const base = normalizeHeadingText(
          heading.plain ? heading.source : headingRenderedText(heading.source, definesLabel, localFootnoteNumber)
        )
        const assigned = chunkSlugs.get(base) ?? []
        assigned.push(heading.slug)
        chunkSlugs.set(base, assigned)
      }
    }
    chunks.push({
      text: prefix + lines.slice(start, end).join('\n'),
      lines: prefixLines + end - start,
      ...(chunkSlugs.size > 0 ? { headingSlugs: chunkSlugs } : {})
    })
    start = end
  }
  return { chunks, longLines }
}

/**
 * Whether some chunk is too large to mount — one that would still reach the renderer whole.
 *
 * @param chunks - The chunks `splitMarkdownChunks` produced.
 */
export function hasOversizedMarkdownChunk(chunks: MarkdownChunk[]): boolean {
  return chunks.some((chunk) => chunk.text.length > MARKDOWN_MAX_BLOCK_CHARS)
}
