import type { LiveTokenizer, LiveTextEdit as TextEdit, Theme, TokensResult } from '@pierre/highlights'

import { normalizeCodeLanguage, resolveCodeTheme } from './catalog'
import { loadCodeTheme } from './theme'

export interface HighlightRange {
  start: number
  end: number
}
export interface HighlightResult {
  start: number
  lines: TokensResult['tokens']
}
export type DocumentChange = { type: 'replace'; code: string } | { type: 'edits'; edits: TextEdit[] }
export interface SnapshotRequest {
  code: string
  language: string
  themes: [string, string]
  foreground?: string
}
export type SnapshotExecutor = (request: SnapshotRequest) => Promise<TokensResult>

export function plainTokens(code: string): TokensResult {
  return { tokens: code.split('\n').map((content) => [{ content, offset: 0 }]) }
}
export function escapeCode(code: string): string {
  return code.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
  )
}

export class HighlightDocument {
  private rows?: { start: number; parts: string[] }[]
  constructor(private tokenizer: LiveTokenizer) {
    this.indexLineEndings()
  }
  get code(): string {
    return this.tokenizer.getText()
  }
  get lineCount(): number {
    return this.rows?.length ?? this.tokenizer.lineCount
  }
  private indexLineEndings(): void {
    const code = this.code
    let start = 0
    // LiveTokenizer recognizes CR as a line break; viewer ranges are LF-delimited.
    this.rows = code.includes('\r')
      ? code.split('\n').map((line) => {
          const parts = line.split('\r')
          const row = { start, parts }
          start += parts.length - Number(line.endsWith('\r'))
          return row
        })
      : undefined
  }
  update(change: DocumentChange): void {
    if (change.type === 'replace') this.tokenizer.reset(change.code)
    else {
      const lines = this.rows ? this.code.split('\n') : undefined
      const splitsCrlf = (point: TextEdit['range']['start']) =>
        lines &&
        point.line < lines.length - 1 &&
        lines[point.line].endsWith('\r') &&
        point.character === lines[point.line].length
      if (change.edits.some(({ range }) => splitsCrlf(range.start) || splitsCrlf(range.end))) {
        // The tokenizer cannot address the interior of CRLF; apply this batch in source coordinates.
        const offset = (point: TextEdit['range']['start']) =>
          lines!.slice(0, point.line).reduce((total, line) => total + line.length + 1, point.character)
        const edits = change.edits.map(({ range, newText }) => ({
          start: offset(range.start),
          end: offset(range.end),
          newText
        }))
        edits.sort((a, b) => a.start - b.start || a.end - b.end)
        const code = edits.reduceRight(
          (source, edit) => source.slice(0, edit.start) + edit.newText + source.slice(edit.end),
          this.code
        )
        this.tokenizer.reset(code)
        this.indexLineEndings()
        return
      }
      const position = (point: TextEdit['range']['start']) => {
        const row = this.rows?.[point.line]
        if (!row) return point
        const prefix = row.parts.join('\r').slice(0, point.character).split('\r')
        return { line: row.start + prefix.length - 1, character: prefix.at(-1)!.length }
      }
      this.tokenizer.applyEdits(
        change.edits.map((edit) => ({
          ...edit,
          range: { start: position(edit.range.start), end: position(edit.range.end) }
        }))
      )
    }
    this.indexLineEndings()
  }
  read(range: HighlightRange): HighlightResult {
    const start = Math.max(0, Math.min(range.start, this.lineCount))
    const end = Math.max(start, Math.min(range.end, this.lineCount))
    return {
      start,
      lines: Array.from({ length: end - start }, (_, index) => {
        const row = this.rows?.[start + index]
        if (!row) return this.tokenizer.getLineTokens(start + index).tokens
        const tokens: TokensResult['tokens'][number] = []
        let offset = 0
        row.parts.forEach((part, segment) => {
          if (part.length)
            for (const token of this.tokenizer.getLineTokens(row.start + segment).tokens) {
              tokens.push({ ...token, offset })
              offset += token.content.length
            }
          if (segment < row.parts.length - 1) {
            tokens.push({ content: '\r', offset })
            offset++
          }
        })
        return tokens
      })
    }
  }
  dispose(): void {
    this.tokenizer.dispose()
  }
}

let runtime: ReturnType<typeof initialize> | undefined
async function initialize() {
  const engine = await import('@pierre/highlights')
  const language = (name: string) => {
    const normalized = normalizeCodeLanguage(name)
    return engine.isSupportedLanguage(normalized) ? normalized : 'text'
  }
  return {
    createDocument(code: string, lang: string, theme: Theme) {
      return new HighlightDocument(
        new engine.LiveTokenizer({ code, lang: language(lang), theme, tokenizeMaxLineLength: 10_000 })
      )
    },
    codeToHtml(code: string, lang: string, theme: Theme) {
      // Wasm output is borrowed; copy before the next engine call.
      return new TextDecoder().decode(engine.codeToHtml(code, { lang: language(lang), theme }))
    },
    snapshot(code: string, lang: string, light: Theme, dark: Theme): TokensResult {
      const result = engine.codeToTokens(code, {
        lang: language(lang),
        themes: { light, dark },
        cssVariablePrefix: '--shiki-',
        tokenizeMaxLineLength: 10_000
      })
      const [fg, ...foreground] = (result.fg ?? '').split(';')
      const [bg, ...background] = (result.bg ?? '').split(';')
      const sourceLines = code.includes('\r') ? code.split('\n') : undefined
      const tokens = result.tokens.map((line, index) => {
        let offset = 0
        const normalized = line.map((token) => {
          const current = { ...token, offset }
          offset += token.content.length
          return current
        })
        if (sourceLines?.[index].endsWith('\r') && offset < sourceLines[index].length)
          normalized.push({ content: '\r', offset })
        return normalized
      })
      return { ...result, tokens, fg, bg, rootStyle: [...foreground, ...background].join(';') }
    }
  }
}
export function loadCodeHighlightRuntime() {
  runtime ??= initialize().catch((error) => {
    runtime = undefined
    throw error
  })
  return runtime
}

export function createSnapshotExecutor(): SnapshotExecutor {
  const cache = new Map<string, { result: TokensResult; size: number }>()
  const pending = new Map<string, Promise<TokensResult>>()
  let retained = 0
  return (request) => {
    const { code, foreground } = request
    const lang = normalizeCodeLanguage(request.language)
    const light = resolveCodeTheme(request.themes[0], 'github-light')
    const dark = resolveCodeTheme(request.themes[1], 'github-dark')
    const key = JSON.stringify([code, lang, light, dark, foreground])
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      return Promise.resolve(cached.result)
    }
    const running = pending.get(key)
    if (running) return running
    const task = Promise.all([
      loadCodeHighlightRuntime(),
      loadCodeTheme(light, foreground),
      loadCodeTheme(dark, foreground)
    ])
      .then(([engine, lightTheme, darkTheme]) => {
        const result = engine.snapshot(code, lang, lightTheme, darkTheme)
        if (code.length <= 1_048_576) {
          cache.set(key, { result, size: code.length })
          retained += code.length
          while (cache.size > 24 || retained > 1_048_576) {
            const oldest = cache.keys().next().value!
            retained -= cache.get(oldest)!.size
            cache.delete(oldest)
          }
        }
        return result
      })
      .finally(() => pending.delete(key))
    pending.set(key, task)
    return task
  }
}
