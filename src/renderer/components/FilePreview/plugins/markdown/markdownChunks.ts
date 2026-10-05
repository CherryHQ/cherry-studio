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

import { isPathologicalLineShape } from '../../textPreviewGuard'

export interface MarkdownChunk {
  /** Markdown source for this chunk, including the carried reference definitions. */
  text: string
  /** Source line count, used to estimate the rendered height before it is measured. */
  lines: number
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
  const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
  if (!match) return null
  const run = match[1]
  // An opening backtick fence cannot carry a backtick in its info string.
  if (run[0] === '`' && line.slice(match[0].length).includes('`')) return null
  return { marker: run[0], length: run.length }
}

function isClosingFence(line: string, fence: Fence): boolean {
  const match = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line)
  return !!match && match[1][0] === fence.marker && match[1].length >= fence.length
}

/**
 * The raw-HTML blocks a blank line does not close (CommonMark types 1–5); the remaining types end at
 * a blank line, which is already a boundary.
 */
function htmlBlockTerminator(line: string): RegExp | null {
  const raw = /^\s{0,3}<(pre|script|style|textarea)\b/i.exec(line)
  if (raw) return new RegExp(`</${raw[1]}\\s*>`, 'i')
  if (/^\s{0,3}<!--/.test(line)) return /-->/
  if (/^\s{0,3}<\?/.test(line)) return /\?>/
  if (/^\s{0,3}<!\[CDATA\[/.test(line)) return /\]\]>/
  if (/^\s{0,3}<![A-Z]/.test(line)) return />/
  return null
}

/** A footnote definition, which owns its indented lines. */
const FOOTNOTE_DEFINITION_START = /^\s{0,3}\[\^[^\]]+\]:/

/**
 * The container markers a definition may sit behind — block quotes, list items, and any nesting of
 * the two. A definition belongs to the document rather than to the block that happens to hold it,
 * so the parser accepts one behind a quote or a list item and registers it for the whole document.
 * The markers repeat, because a quote may hold a list item that holds the definition.
 */
const DEFINITION_CONTAINER = /^(?:(?:[ \t]*>)+[ \t]*|(?:[ \t]*[-+*]|[ \t]*\d{1,9}[.)])[ \t]+)+/

/** A block quote marker. */
const QUOTE_MARKER = /^[ \t]*>[ \t]?/

/** A list item marker, which on a continuation line always opens a list rather than continuing. */
const LIST_MARKER = /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+/

/** The block quote markers in a container prefix — how deeply a definition is quoted. */
function quoteDepth(container: string): number {
  return container.match(/[ \t]*>[ \t]?/g)?.length ?? 0
}

/**
 * The column a continuation's block quote has to reach to stay inside the list item that holds the
 * definition, or -1 when no list item does. A quote one column further left closes the list item
 * instead of continuing it — but only when the list item is the outermost container, since a quote
 * already outside it keeps the line inside the quote whatever column it sits in.
 */
function listContentColumn(container: string): number {
  if (!LIST_MARKER.test(container)) return -1
  return container.match(/[ \t]+/)?.[0].length ?? -1
}

/**
 * A link reference definition label, which may leave its destination to a line of its own. A label
 * may hold an escaped closing bracket (`[a\]b]`), so brackets only end the label when unescaped.
 */
const LINK_DEFINITION_LABEL = /^\[(?!\^)((?:\\.|[^\]\\])+)\][ \t]*:([ \t]*)([\s\S]*)$/

/** A link destination: an angle-bracketed run or a whitespace-free one, behind any indentation. */
const LINK_DESTINATION = /^[ \t]*(?:<[^<>]*>|[^\s]+)/

/** A link title, which may sit on the line below the destination; its delimiter may be escaped. */
const LINK_TITLE = /^[ \t]*(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\((?:\\.|[^)\\\n])*\))[ \t]*$/

/**
 * A title the parser has accepted the opening of but not yet closed: the title runs on to the lines
 * below the one it opens on, and only the closing delimiter ends it.
 */
const LINK_TITLE_OPEN = /^[ \t]*(?:"(?:\\.|[^"\\\n])*|'(?:\\.|[^'\\\n])*|\((?:\\.|[^)\\\n])*)$/

const INDENTED_LINE = /^\s+\S/

/**
 * A block that ends an open link definition where it appears, so a title that never closes cannot
 * swallow it. A fence or heading indented four or more columns is content of the definition rather
 * than a block of its own, and an autolink stays title text, so neither ends it.
 */
const BLOCK_START =
  /^ {0,3}(?:`{3,}|~{3,}|#{1,6}(?:[ \t]|$)|(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$|=+[ \t]*$|<(?:!--|\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t/>]|$)))/

/**
 * The indent a line needs to continue a definition across a blank one. The parser requires four
 * columns there, so a shallower indented line after a blank is a paragraph of its own — and
 * carrying it would print that paragraph in every chunk.
 */
function continuesDefinitionAfterBlank(line: string | undefined): boolean {
  if (line === undefined || !INDENTED_LINE.test(line)) return false
  // A tab advances to the next multiple of four, so the columns a line is indented by are not the
  // characters it is indented with.
  let columns = 0
  for (const character of line) {
    if (character === ' ') columns += 1
    else if (character === '\t') columns += 4 - (columns % 4)
    else return columns >= 4
  }
  return false
}

/**
 * The bare text of a link reference definition and the lines it covers, or null when the line opens
 * none. The destination may sit a line below the label and the title a line below that, but nothing
 * may follow the destination except the title — so `[label]:\ntext` is a paragraph and
 * `[label]:\n/url` is not. Hoisting either the wrong way would show it in every chunk, so the span
 * has to be exact. The definition is returned without its block quote or list marker because that
 * container belongs to the chunk it was written in, and carrying it would render an empty one.
 */
function linkDefinition(lines: string[], index: number): { text: string; lines: number } | null {
  const start = DEFINITION_CONTAINER.exec(lines[index])
  const quotes = start ? quoteDepth(start[0]) : 0
  const contentColumn = start ? listContentColumn(start[0]) : -1
  const label = LINK_DEFINITION_LABEL.exec(start ? lines[index].slice(start[0].length) : lines[index])
  if (!label) return null
  const body = [`[${label[1]}]:${label[2]}${label[3]}`]
  let tail = label[3]
  let span = 1
  if (!LINK_DESTINATION.test(tail)) {
    const next = continuation(lines[index + 1], quotes, contentColumn)
    if (next === undefined) return null
    tail = next
    body.push(next)
    span = 2
  }
  tail = tail.replace(LINK_DESTINATION, '')
  // Whatever is left on the destination's line has to be a title, but the title may wrap: the parser
  // closes it on whichever line carries the closing delimiter, so one that is still open here is
  // taken from the lines below rather than rejected. Anything that is neither closed nor open, and
  // any title that never closes, is a paragraph rather than a definition.
  let title: string | undefined = /^[ \t]*$/.test(tail) ? undefined : tail
  if (title === undefined) {
    const below = continuation(lines[index + span], quotes, contentColumn)
    if (below !== undefined && (LINK_TITLE.test(below) || LINK_TITLE_OPEN.test(below))) {
      title = below
      body.push(below)
      span += 1
    }
  } else if (!LINK_TITLE.test(title) && !LINK_TITLE_OPEN.test(title)) {
    return null
  }
  while (title !== undefined && !LINK_TITLE.test(title)) {
    const next = continuation(lines[index + span], quotes, contentColumn)
    if (next === undefined) return null
    body.push(next)
    span += 1
    title = `${title} ${next}`.trim()
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
function continuation(line: string | undefined, quotes: number, contentColumn: number): string | undefined {
  if (line === undefined) return undefined
  let content = line
  let seen = 0
  for (let quote = QUOTE_MARKER.exec(content); quote; quote = QUOTE_MARKER.exec(content)) {
    // A quote that does not reach the column the list item indents its content to has already
    // fallen out of that item, and opens a block of its own instead of continuing the definition.
    if (seen === 0 && contentColumn > 0 && quote.index + quote[0].indexOf('>') < contentColumn) return undefined
    content = content.slice(quote[0].length)
    seen += 1
  }
  if (seen > quotes || LIST_MARKER.test(content) || BLOCK_START.test(content)) return undefined
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

  // CommonMark normalizes CRLF to LF before parsing, so chunks carry LF too. Every line-anchored
  // match below would otherwise be blind to the `\r` a CRLF document leaves at each line end: a
  // `$$` run that never closes, or a list marker that never matches, suppresses every later
  // boundary and sends the whole document to the plain-text fallback.
  const lines = content.split(/\r?\n/)
  // A trailing terminator ends its line rather than starting another, so the split's last element is
  // not a line. The long-line average counts lines, and an extra empty one would halve it.
  const lineCount = content.endsWith('\n') ? lines.length - 1 : lines.length
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
  let inDefinition = false
  let footnoteDefinition = false
  let run: ListRun | null = null

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
      if (htmlTerminator.test(line)) htmlTerminator = null
      continue
    }
    if (mathRun) {
      mathRun = trackMathRun(mathRun, line)
      continue
    }
    if (dollarFence > 0) {
      if (dollarFenceAtEnd(line) >= dollarFence) dollarFence = 0
      continue
    }
    const opened = parseFence(line)
    if (opened) {
      fence = opened
      inDefinition = false
      continue
    }
    const htmlEnd = htmlBlockTerminator(line)
    if (htmlEnd) {
      if (!htmlEnd.test(line)) htmlTerminator = htmlEnd
      inDefinition = false
      continue
    }
    const dollarOpen = dollarFenceAtStart(line)
    if (dollarOpen > 0 && !dollarFenceClosesOnOwnLine(line, dollarOpen)) {
      dollarFence = dollarOpen
      inDefinition = false
      continue
    }
    const math = openMathRun(line)
    if (math) {
      mathRun = math
      inDefinition = false
      continue
    }
    // A multi-paragraph footnote definition continues on indented lines, including across its blank
    // lines — where the parser holds it to four columns, so a shallower one starts a new block.
    const indentedContinuation =
      INDENTED_LINE.test(line) || (blank && continuesDefinitionAfterBlank(lines[nextContent[i]]))
    if (inDefinition && indentedContinuation && (!blank || footnoteDefinition)) {
      definitions.push(line)
      definitionLines += 1
      continue
    }
    // A definition behind a quote or list item is carried without that container, which belongs to
    // the chunk it was written in: carrying it would render an empty quote or list in every other.
    const container = DEFINITION_CONTAINER.exec(line)
    const uncontained = container ? line.slice(container[0].length) : line
    if (FOOTNOTE_DEFINITION_START.test(uncontained)) {
      definitions.push(uncontained)
      definitionLines += 1
      inDefinition = true
      footnoteDefinition = true
      // A definition written as a list item still numbers that list, so the blank line behind it
      // may not end one — the same reason an ordinary item keeps the run alive.
      const item = LIST_ITEM.exec(line)
      if (item) run = trackListItem(run, item)
      continue
    }
    // A link definition is a run of up to three lines, none of them blank, so it holds no boundary.
    const definition = linkDefinition(lines, i)
    if (definition) {
      definitions.push(definition.text)
      definitionLines += definition.lines
      bufferChars += definition.text.length + 1
      i += definition.lines - 1
      inDefinition = false
      const item = LIST_ITEM.exec(line)
      if (item) run = trackListItem(run, item)
      continue
    }
    inDefinition = false

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
    const nextItem = followedBy >= 0 ? LIST_ITEM.exec(lines[followedBy]) : null
    // A list is one block: its items number themselves from its first marker and its blank lines
    // are what make it loose, so only a blank line the list does not span is free.
    const listContinues =
      run !== null && nextItem !== null && nextItem[1] === run.indent && (nextItem[2] ?? nextItem[4]) === run.marker
    if (listContinues) continue
    run = null
    if (bufferChars >= budgetChars) {
      boundaries.push(i + 1)
      bufferChars = 0
    }
  }

  const prefix = definitions.length > 0 ? `${definitions.join('\n')}\n\n` : ''
  const prefixLines = definitionLines > 0 ? definitionLines + 1 : 0
  const chunks: MarkdownChunk[] = []
  let start = 0
  for (const end of [...boundaries, lines.length]) {
    if (end <= start) continue
    chunks.push({
      text: prefix + lines.slice(start, end).join('\n'),
      lines: prefixLines + end - start
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
