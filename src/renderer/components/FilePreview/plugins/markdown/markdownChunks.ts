/**
 * Markdown source splitting for the windowed preview.
 *
 * Each chunk renders as its own Markdown document, so a boundary may only fall on a blank line
 * where every spanning construct is closed — fenced code, display math, raw HTML, indented code —
 * and where an ordered list keeps the numbering it has as one list.
 *
 * Reference definitions belong to the document rather than to a chunk: a link used in one chunk may
 * be defined in another, and a reference whose definition is missing degrades to literal text. Every
 * definition is therefore carried into every chunk, where an unused one renders nothing.
 */

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

/** A link reference or footnote definition; both render nothing until something references them. */
const DEFINITION_START = /^\s{0,3}(?:\[[^\]]+\]:\s*\S|\[\^[^\]]+\]:)/

/** A footnote definition owns its indented lines; a link definition ends with its line run. */
const FOOTNOTE_DEFINITION_START = /^\s{0,3}\[\^[^\]]+\]:/

const INDENTED_LINE = /^\s+\S/

/** An ordered item marker, with the indentation and delimiter that identify its list. */
const ORDERED_ITEM = /^( {0,3})(\d{1,9})([.)])(?:[ \t]|$)/

/**
 * A block start at column 0. Lazy continuation is the only line a list item owns there, and it never
 * starts a block, so one of these always ends an open list.
 */
const TOP_LEVEL_BLOCK_START =
  /^#{1,6}(?:[ \t]|$)|^>|^[-+*](?:[ \t]|$)|^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/

/** The environments `remarkLatexMath` treats as display math. */
const LATEX_ENVIRONMENTS = 'equation\\*?|align\\*?|aligned|gather\\*?|gathered|multline\\*?'

/**
 * The terminator of the display math `remarkLatexMath` opens with a bracket or an environment —
 * the `$$` form is tracked separately, because it closes with the same delimiter it opens with.
 */
function displayMathTerminator(line: string): RegExp | null {
  const environment = new RegExp(`^\\s{0,3}\\\\begin\\{(${LATEX_ENVIRONMENTS})\\}`).exec(line)
  if (environment) return new RegExp(`\\\\end\\{${environment[1]}\\}`)
  if (/^\s{0,3}\\\[(?!.*\\\])/.test(line)) return /\\\]/
  return null
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

interface OrderedRun {
  indent: string
  delimiter: string
  /** The number of the last sibling item; the list renders one more per item from its first marker. */
  last: number
  /** Whether the written numbers so far are the ones the list renders, so a break would not renumber. */
  sequential: boolean
}

function trackOrderedItem(run: OrderedRun | null, item: RegExpExecArray): OrderedRun {
  const [, indent, digits, delimiter] = item
  const number = Number(digits)
  // A deeper marker belongs to a nested list, which cannot renumber this one.
  if (run && indent.length > run.indent.length) return run
  if (run && indent.length === run.indent.length && delimiter === run.delimiter) {
    return { indent, delimiter, last: number, sequential: run.sequential && number === run.last + 1 }
  }
  return { indent, delimiter, last: number, sequential: true }
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
): MarkdownChunk[] {
  if (content.length === 0) return []

  const lines = content.split('\n')
  // The next line with content on it, so a run of blank lines belongs to the block that spans it.
  const nextContent = new Array<number>(lines.length).fill(-1)
  for (let i = lines.length - 2, next = -1; i >= 0; i--) {
    if (lines[i + 1].trim() !== '') next = i + 1
    nextContent[i] = next
  }

  const definitions: string[] = []
  const boundaries: number[] = []
  let bufferChars = 0
  let fence: Fence | null = null
  let dollarFence = 0
  let mathTerminator: RegExp | null = null
  let htmlTerminator: RegExp | null = null
  let inDefinition = false
  let footnoteDefinition = false
  let run: OrderedRun | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const blank = line.trim() === ''
    bufferChars += line.length + 1

    if (fence) {
      if (isClosingFence(line, fence)) fence = null
      continue
    }
    if (htmlTerminator) {
      if (htmlTerminator.test(line)) htmlTerminator = null
      continue
    }
    if (mathTerminator) {
      if (mathTerminator.test(line)) mathTerminator = null
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
    const mathEnd = displayMathTerminator(line)
    if (mathEnd) {
      if (!mathEnd.test(line)) mathTerminator = mathEnd
      inDefinition = false
      continue
    }
    // A multi-paragraph footnote definition continues on indented lines, including across its blank lines.
    const indentedContinuation = INDENTED_LINE.test(line) || (blank && INDENTED_LINE.test(lines[nextContent[i]] ?? ''))
    if (inDefinition && indentedContinuation && (!blank || footnoteDefinition)) {
      definitions.push(line)
      continue
    }
    if (DEFINITION_START.test(line)) {
      definitions.push(line)
      inDefinition = true
      footnoteDefinition = FOOTNOTE_DEFINITION_START.test(line)
      continue
    }
    inDefinition = false

    const item = ORDERED_ITEM.exec(line)
    if (item) {
      run = trackOrderedItem(run, item)
      continue
    }
    if (TOP_LEVEL_BLOCK_START.test(line)) run = null

    // A blank line ends the current block, so it is the only place a chunk may safely end.
    if (!blank) continue
    const followedBy = nextContent[i]
    if (followedBy >= 0 && INDENTED_LINE.test(lines[followedBy])) continue
    const nextItem = followedBy >= 0 ? ORDERED_ITEM.exec(lines[followedBy]) : null
    // An ordered list numbers its items from its first marker, so a boundary is free only where the
    // written number already is the one that list would render here.
    if (run !== null && nextItem !== null && nextItem[1] === run.indent && nextItem[3] === run.delimiter) {
      if (!run.sequential || Number(nextItem[2]) !== run.last + 1) continue
    } else {
      run = null
    }
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
  return chunks
}

/**
 * Whether some chunk is too large to mount — one that would still reach the renderer whole.
 *
 * @param chunks - The chunks `splitMarkdownChunks` produced.
 */
export function hasOversizedMarkdownChunk(chunks: MarkdownChunk[]): boolean {
  return chunks.some((chunk) => chunk.text.length > MARKDOWN_MAX_BLOCK_CHARS)
}
