import { isSupportedLanguage } from '@pierre/highlights'
import { describe, expect, it, vi } from 'vitest'

import {
  CODE_LANGUAGES,
  createSnapshotExecutor,
  loadCodeHighlightRuntime,
  loadCodeTheme,
  normalizeCodeLanguage
} from '../../../code-highlight'

const request = {
  code: 'const a = "🍒"\nconst b = 2\n',
  language: 'ts',
  themes: ['github-light', 'github-dark'] as [string, string]
}
describe('code highlight core', () => {
  it('keeps the public compatibility catalog valid against the installed engine', () => {
    for (const [canonical, aliases] of Object.entries(CODE_LANGUAGES)) {
      expect(isSupportedLanguage(canonical)).toBe(true)
      for (const alias of aliases) expect(normalizeCodeLanguage(` ${alias.toUpperCase()} `)).toBe(canonical)
    }
  })
  it('deduplicates identical work and normalizes UTF-16 offsets to each line', async () => {
    const execute = createSnapshotExecutor()
    const pending = execute(request)
    expect(execute(request)).toBe(pending)
    const result = await pending
    expect(await execute({ ...request, language: 'typescript' })).toBe(result)
    expect(result.tokens.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(request.code)
    expect(result.tokens[1][0].offset).toBe(0)
    const changed = await execute({ ...request, code: request.code.replace('b = 2', 'c = 3') })
    expect(changed.tokens[1].map((token) => token.content).join('')).toBe('const c = 3')
  })
  it('evicts by count and retained source size and does not retain oversized results', async () => {
    const execute = createSnapshotExecutor()
    const first = await execute(request)
    for (let i = 0; i < 24; i++) await execute({ ...request, code: String(i) })
    expect(await execute(request)).not.toBe(first)
    const large = { ...request, code: 'x'.repeat(600_000), language: 'text' }
    const largeResult = await execute(large)
    await execute({ ...large, code: 'y'.repeat(600_000) })
    expect(await execute(large)).not.toBe(largeResult)
    const oversized = { ...large, code: 'z'.repeat(1_048_577) }
    expect(await execute(oversized)).not.toBe(await execute(oversized))
  })
  it('applies middle edits and multiline appends without losing lexer state or Unicode', async () => {
    const runtime = await loadCodeHighlightRuntime()
    const doc = runtime.createDocument('/* 🍒', 'ts', await loadCodeTheme('one-light'))
    try {
      doc.update({
        type: 'edits',
        edits: [
          { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } }, newText: '\n */\nconst a = 1' }
        ]
      })
      expect(doc.code).toBe('/* 🍒\n */\nconst a = 1')
      doc.update({
        type: 'edits',
        edits: [{ range: { start: { line: 2, character: 6 }, end: { line: 2, character: 7 } }, newText: '名字' }]
      })
      const result = doc.read({ start: 2, end: 3 })
      expect(result.lines[0].map((token) => token.content).join('')).toBe('const 名字 = 1')
      expect(new Set(result.lines[0].map((token) => token.color)).size).toBeGreaterThan(1)
    } finally {
      doc.dispose()
    }
  })
  it('does not cache a failed engine result and allows an identical request to recover', async () => {
    const runtime = await loadCodeHighlightRuntime()
    const snapshot = vi.spyOn(runtime, 'snapshot').mockImplementationOnce(() => {
      throw new Error('Injected engine failure')
    })
    try {
      const execute = createSnapshotExecutor()
      await expect(execute(request)).rejects.toThrow('Injected engine failure')
      const recovered = await execute(request)
      expect(recovered.tokens.flat().some((token) => token.htmlStyle?.color)).toBe(true)
      expect(recovered.tokens.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(request.code)
    } finally {
      snapshot.mockRestore()
    }
  })

  it.each(['const s = "🍒"\r\n\t\r\n', 'const a = 1\rconst b = 2\n', '/* open\r'])(
    'preserves original line endings through ranges, snapshots and appends: %j',
    async (code) => {
      const runtime = await loadCodeHighlightRuntime()
      const doc = runtime.createDocument(code, 'ts', await loadCodeTheme('one-light'))
      try {
        const source = () =>
          doc
            .read({ start: 0, end: doc.lineCount })
            .lines.map((line) => line.map((token) => token.content).join(''))
            .join('\n')
        expect(source()).toBe(code)
        const rows = code.split('\n')
        const end = { line: rows.length - 1, character: rows.at(-1)!.length }
        doc.update({ type: 'edits', edits: [{ range: { start: end, end }, newText: '\n */\nconst final = 3\r\n' }] })
        expect(source()).toBe(code + '\n */\nconst final = 3\r\n')
        const snapshot = await createSnapshotExecutor()({ ...request, code })
        expect(snapshot.tokens.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(code)
      } finally {
        doc.dispose()
      }
    }
  )
})
