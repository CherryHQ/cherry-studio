import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { Parser, Tree } from '@lezer/common'
import { TreeFragment } from '@lezer/common'
import { highlightTree } from '@lezer/highlight'

import type { DocumentChange, HighlightRange } from '../../code-highlight'
import { getCodeBlockParser, loadCodeBlockLanguage } from './language'
import { codeBlockHighlightStyle } from './syntax'

export interface CodeBlockToken {
  content: string
  offset: number
  className?: string
}

export interface CodeBlockHighlightResult {
  start: number
  lines: CodeBlockToken[][]
}

/** Read an editor's already parsed range without parsing or copying the full document. */
export function readCodeBlockState(state: EditorState, range: HighlightRange): CodeBlockHighlightResult | null {
  const start = Math.max(0, Math.min(range.start, state.doc.lines))
  const end = Math.max(start, Math.min(range.end, state.doc.lines))
  if (end === start) return { start, lines: [] }
  if (!syntaxTreeAvailable(state, state.doc.line(end).to)) return null
  const tree = syntaxTree(state)
  const lines = Array.from({ length: end - start }, (_, index) => {
    const line = state.doc.line(start + index + 1)
    const tokens: CodeBlockToken[] = []
    let cursor = line.from
    highlightTree(
      tree,
      codeBlockHighlightStyle,
      (from, to, className) => {
        if (from > cursor) tokens.push({ content: state.doc.sliceString(cursor, from), offset: cursor - line.from })
        tokens.push({ content: state.doc.sliceString(from, to), offset: from - line.from, className })
        cursor = to
      },
      line.from,
      line.to
    )
    if (cursor < line.to || tokens.length === 0)
      tokens.push({ content: state.doc.sliceString(cursor, line.to), offset: cursor - line.from })
    return tokens
  })
  return { start, lines }
}

function lineOffsets(code: string) {
  const offsets = [0]
  for (let index = 0; index < code.length; index++) if (code.charCodeAt(index) === 10) offsets.push(index + 1)
  return offsets
}

export function plainCodeBlockTokens(code: string, range: HighlightRange): CodeBlockHighlightResult {
  return {
    start: range.start,
    lines: code
      .split('\n')
      .slice(range.start, range.end)
      .map((content) => [{ content, offset: 0 }])
  }
}

export class CodeBlockDocument {
  private offsets: number[]
  private tree?: Tree
  private fragments: readonly TreeFragment[] = []
  private disposed = false

  constructor(
    public code: string,
    private parser: Parser | null
  ) {
    this.offsets = lineOffsets(code)
  }

  update(change: DocumentChange) {
    const previousLength = this.code.length
    const edits =
      change.type === 'replace'
        ? [{ from: 0, to: previousLength, text: change.code }]
        : change.edits
            .map(({ range, newText }) => ({
              from: this.offsets[range.start.line] + range.start.character,
              to: this.offsets[range.end.line] + range.end.character,
              text: newText
            }))
            .sort((a, b) => a.from - b.from || a.to - b.to)
    let delta = 0
    const changed = edits.map(({ from, to, text }) => {
      const fromB = from + delta
      delta += text.length - (to - from)
      return { fromA: from, toA: to, fromB, toB: fromB + text.length }
    })
    this.fragments = TreeFragment.applyChanges(this.fragments, changed)
    this.tree = undefined
    this.code = edits.reduceRight((code, edit) => code.slice(0, edit.from) + edit.text + code.slice(edit.to), this.code)
    if (edits.length === 1 && edits[0].from === previousLength && edits[0].to === previousLength) {
      for (let index = previousLength; index < this.code.length; index++)
        if (this.code.charCodeAt(index) === 10) this.offsets.push(index + 1)
    } else this.offsets = lineOffsets(this.code)
  }

  async read(range: HighlightRange): Promise<CodeBlockHighlightResult> {
    const start = Math.max(0, Math.min(range.start, this.offsets.length))
    const end = Math.max(start, Math.min(range.end, this.offsets.length))
    const from = this.offsets[start] ?? this.code.length
    const to = this.offsets[end] ?? this.code.length
    if (this.parser && (!this.tree || this.tree.length < to)) {
      const parsing = this.parser.startParse(this.code, this.fragments)
      parsing.stopAt(to)
      let tree: Tree | null = null
      while (!tree) {
        if (this.disposed) throw new Error('Code block document closed')
        const deadline = performance.now() + 8
        do {
          tree = parsing.advance()
        } while (!tree && performance.now() < deadline)
        if (!tree) await new Promise((resolve) => setTimeout(resolve, 0))
      }
      this.tree = tree
      this.fragments = TreeFragment.addTree(tree, this.fragments, tree.length < this.code.length)
    }
    const spans: { from: number; to: number; className: string }[] = []
    if (this.tree)
      highlightTree(
        this.tree,
        codeBlockHighlightStyle,
        (from, to, className) => spans.push({ from, to, className }),
        from,
        to
      )
    let spanIndex = 0
    const lines: CodeBlockToken[][] = []
    for (let line = start; line < end; line++) {
      const rowStart = this.offsets[line]
      const rowEnd = (this.offsets[line + 1] ?? this.code.length + 1) - 1
      let cursor = rowStart
      const tokens: CodeBlockToken[] = []
      while (spanIndex < spans.length && spans[spanIndex].to <= rowStart) spanIndex++
      let index = spanIndex
      while (index < spans.length && spans[index].from < rowEnd) {
        const span = spans[index]
        const begin = Math.max(rowStart, span.from)
        const finish = Math.min(rowEnd, span.to)
        if (begin > cursor) tokens.push({ content: this.code.slice(cursor, begin), offset: cursor - rowStart })
        tokens.push({ content: this.code.slice(begin, finish), offset: begin - rowStart, className: span.className })
        cursor = finish
        if (span.to > rowEnd) break
        index++
      }
      if (cursor < rowEnd || tokens.length === 0)
        tokens.push({ content: this.code.slice(cursor, rowEnd), offset: cursor - rowStart })
      lines.push(tokens)
    }
    return { start, lines }
  }

  dispose() {
    this.disposed = true
    this.tree = undefined
    this.fragments = []
    this.code = ''
    this.offsets = []
  }
}

export async function createCodeBlockDocument(code: string, language: string) {
  const support = await loadCodeBlockLanguage(language)
  return new CodeBlockDocument(code, support ? getCodeBlockParser(support) : null)
}
