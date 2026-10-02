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
 * The container markers a definition may sit behind — a block quote, a list item, or both. A
 * definition belongs to the document rather than to the block that happens to hold it, so the
 * parser accepts one in a quote or a list item and registers it for the whole document.
 */
const DEFINITION_CONTAINER = /^(?:[ \t]*>)+[ \t]*|(?:[ \t]*[-+*]|[ \t]*\d{1,9}[.)])[ \t]+/

/**
 * A link reference definition label, which may leave its destination to a line of its own. A label
 * may hold an escaped closing bracket (`[a\]b]`), so brackets only end the label when unescaped.
 */
const LINK_DEFINITION_LABEL = /^\[(?!\^)((?:\\.|[^\]\\])+)\][ \t]*:([ \t]*)([\s\S]*)$/

/** A link destination: an angle-bracketed run or a whitespace-free one. */
const LINK_DESTINATION = /^(?:<[^<>]*>|[^\s]+)/

/** A link title, which may sit on the line below the destination. */
const LINK_TITLE = /^[ \t]*(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))[ \t]*$/

const INDENTED_LINE = /^\s+\S/

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
  const label = LINK_DEFINITION_LABEL.exec(start ? lines[index].slice(start[0].length) : lines[index])
  if (!label) return null
  const body = [`[${label[1]}]:${label[2]}${label[3]}`]
  let tail = label[3]
  let span = 1
  if (!LINK_DESTINATION.test(tail)) {
    const next = continuation(lines[index + 1])
    if (next === undefined) return null
    tail = next
    body.push(next)
    span = 2
  }
  tail = tail.replace(LINK_DESTINATION, '')
  if (!/^[ \t]*$/.test(tail)) {
    if (!LINK_TITLE.test(tail)) return null
  } else {
    const title = continuation(lines[index + span])
    if (title !== undefined) {
      if (!LINK_TITLE.test(title)) return null
      body.push(title)
      span += 1
    }
  }
  return { text: body.join('\n'), lines: span }
}

/**
 * The content a definition continuation line carries, or undefined when it is not one of ours. Only
 * a container marker is removed: the indentation that follows it is what the parser reads to know
 * the line continues this definition rather than starting a new block.
 */
function continuation(line: string | undefined): string | undefined {
  if (line === undefined) return undefined
  const container = DEFINITION_CONTAINER.exec(line)
  const content = container ? line.slice(container[0].length) : line
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
    // A multi-paragraph footnote definition continues on indented lines, including across its blank lines.
    const indentedContinuation = INDENTED_LINE.test(line) || (blank && INDENTED_LINE.test(lines[nextContent[i]] ?? ''))
    if (inDefinition && indentedContinuation && (!blank || footnoteDefinition)) {
      definitions.push(line)
      continue
    }
    if (FOOTNOTE_DEFINITION_START.test(line)) {
      definitions.push(line)
      inDefinition = true
      footnoteDefinition = true
      continue
    }
    // A link definition is a run of up to three lines, none of them blank, so it holds no boundary.
    const definition = linkDefinition(lines, i)
    if (definition) {
      definitions.push(definition.text)
      bufferChars += definition.text.length + 1
      i += definition.lines - 1
      inDefinition = false
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
  const prefixLines = definitions.length > 0 ? definitions.length + 1 : 0
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
