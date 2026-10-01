/**
 * Markdown source splitting for the windowed preview.
 *
 * Each chunk renders as its own Markdown document, so a boundary may only fall on a blank line
 * where every spanning construct is closed — fenced code, display math, raw HTML — and no indented
 * continuation follows it.
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

const INDENTED_LINE = /^\s+\S/

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
  const definitions: string[] = []
  const boundaries: number[] = []
  let bufferChars = 0
  let fence: Fence | null = null
  let inDisplayMath = false
  let htmlTerminator: RegExp | null = null
  let inDefinition = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    bufferChars += line.length + 1

    if (fence) {
      if (isClosingFence(line, fence)) fence = null
      continue
    }
    if (htmlTerminator) {
      if (htmlTerminator.test(line)) htmlTerminator = null
      continue
    }
    const opened = parseFence(line)
    if (opened) {
      fence = opened
      inDefinition = false
      continue
    }
    const terminator = htmlBlockTerminator(line)
    if (terminator) {
      if (!terminator.test(line)) htmlTerminator = terminator
      inDefinition = false
      continue
    }
    if (line.trim() === '$$') {
      inDisplayMath = !inDisplayMath
      inDefinition = false
      continue
    }
    if (!inDisplayMath && DEFINITION_START.test(line)) {
      definitions.push(line)
      inDefinition = true
      continue
    }
    if (inDefinition && INDENTED_LINE.test(line)) {
      definitions.push(line)
      continue
    }
    inDefinition = false

    // A blank line ends the current block, so it is the only place a chunk may safely end.
    if (inDisplayMath || line.trim() !== '') continue
    if (INDENTED_LINE.test(lines[i + 1] ?? '')) continue
    if (bufferChars >= budgetChars) boundaries.push(i + 1)
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
 * Whether some block is too large to window — a single code fence or paragraph that would still
 * reach the renderer whole.
 *
 * @param content - The markdown source.
 */
export function hasOversizedMarkdownBlock(content: string): boolean {
  return splitMarkdownChunks(content).some((chunk) => chunk.text.length > MARKDOWN_MAX_BLOCK_CHARS)
}
