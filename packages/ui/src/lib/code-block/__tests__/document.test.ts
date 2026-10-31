import { ensureSyntaxTree, highlightingFor, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { highlightTree } from '@lezer/highlight'
import { describe, expect, it } from 'vitest'

import {
  codeBlockHighlightStyle,
  createCodeBlockDocument,
  loadCodeBlockLanguage,
  readCodeBlockState
} from '../../../code-block'

const sourceOf = (result: Awaited<ReturnType<Awaited<ReturnType<typeof createCodeBlockDocument>>['read']>>) =>
  result.lines.map((line) => line.map((token) => token.content).join('')).join('\n')

describe('Code block syntax contract', () => {
  it.each([
    ['jsonc', '{ "greeting": "你好 🥟", "count": 42 }\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['.JSONC', '{ "greeting": "你好 🥟", "count": 42 }\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['shellscript', 'echo "你好 🥟" # comment\r\n', '"你好 🥟"', 'code-syntax-string'],
    [' SHELLSCRIPT ', 'echo "你好 🥟" # comment\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['scm', '(define enabled #t)\n', '#t', 'code-syntax-keyword'],
    ['clojure', '(def greeting "你好 🥟")\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['haskell', 'greeting = "你好 🥟"\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['powershell', 'Write-Host "你好 🥟"\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['perl', 'print "你好 🥟";\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['latex', '\\textbf{你好 🥟}\r\n', '\\textbf', 'code-syntax-tag'],
    ['asm', '# comment\r\n', '# comment', 'code-syntax-comment'],
    ['erlang', 'greeting() -> "你好 🥟".\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['fortran-free-form', 'print *, "你好 🥟"\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['fortran-fixed-form', '      print *, "你好 🥟"\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['fsharp', 'let greeting = "你好 🥟"\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['julia', 'println("你好 🥟")\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['objective-c', 'const char *greeting = "你好 🥟";\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['ocaml', 'let greeting = "你好 🥟";;\r\n', '"你好 🥟"', 'code-syntax-string'],
    ['pascal', "writeln('你好 🥟');\r\n", "'你好 🥟'", 'code-syntax-string'],
    ['wasm', ';; comment\r\n', ';; comment', 'code-syntax-comment']
  ])(
    'preserves supported %s names and aliases without losing syntax or source',
    async (language, code, content, className) => {
      const doc = await createCodeBlockDocument(code, language)
      try {
        const result = await doc.read({ start: 0, end: 2 })
        expect(sourceOf(result)).toBe(code)
        expect(result.lines.flat()).toContainEqual(
          expect.objectContaining({ content: expect.stringContaining(content), className })
        )
      } finally {
        doc.dispose()
      }
    }
  )

  it.each(['jsonc', 'clojure'])('honors caller configuration before the %s grammar', async (language) => {
    const support = await loadCodeBlockLanguage(language, {
      CustomScript: { type: 'programming', aliases: [language], extensions: ['.ts'] }
    })
    const state = EditorState.create({ doc: 'const answer = 42;', extensions: [support!] })
    ensureSyntaxTree(state, state.doc.length, 1000)
    expect(readCodeBlockState(state, { start: 0, end: 1 })?.lines.flat()).toContainEqual(
      expect.objectContaining({ content: 'const', className: 'code-syntax-keyword' })
    )
  })

  it('preserves comment classes on the first read from an edited syntax tree', async () => {
    const support = await loadCodeBlockLanguage('ts')
    const state = EditorState.create({
      doc: '/* start\ncomment 中文 🥟\n*/\nconst value = 1;\n',
      extensions: [support!]
    })
    const edited = state.update({ changes: { from: 9, insert: 'draft ' } }).state
    ensureSyntaxTree(edited, edited.doc.length, 1000)
    const result = readCodeBlockState(edited, { start: 1, end: 3 })!
    expect(sourceOf(result)).toBe('draft comment 中文 🥟\n*/')
    expect(result.lines.flat().every((token) => token.className === 'code-syntax-comment')).toBe(true)
  })

  it('leaves an unparsed range to the worker instead of classifying it as plain text', async () => {
    const support = await loadCodeBlockLanguage('ts')
    const state = EditorState.create({ doc: '// comment\n'.repeat(100000), extensions: [support!] })
    expect(readCodeBlockState(state, { start: 99999, end: 100000 })).toBeNull()
  })

  it.each([
    ['ts', 'const greeting = "你好 🥟";\r\n/* comment */\r\nconst answer = 42;  \r\n\r\n'],
    ['yaml', 'name: "hello"\nitems:\n  - 42\n'],
    ['sh', 'echo "hello" # comment\n'],
    ['dot', 'digraph { A -> B; }'],
    ['mmd', 'graph TD\nA-->B']
  ])('matches the real editor syntax classes for %s without changing source', async (language, code) => {
    const support = await loadCodeBlockLanguage(language)
    expect(support).not.toBeNull()
    const state = EditorState.create({ doc: code, extensions: [support!, syntaxHighlighting(codeBlockHighlightStyle)] })
    const tree = ensureSyntaxTree(state, state.doc.length, 1000)!
    const expected: { text: string; className: string }[] = []
    highlightTree(tree, { style: (tags) => highlightingFor(state, tags) }, (from, to, className) => {
      expected.push({ text: state.sliceDoc(from, to), className })
    })
    const doc = await createCodeBlockDocument(code.replaceAll('\r\n', '\n'), language)
    const result = await doc.read({ start: 0, end: code.split('\n').length })
    const actual = result.lines
      .flat()
      .filter((token) => token.className)
      .map((token) => ({ text: token.content, className: token.className! }))
    expect(actual).toEqual(
      expected.flatMap((span) =>
        span.text
          .split('\n')
          .filter(Boolean)
          .map((text) => ({ text, className: span.className }))
      )
    )
    const original = await createCodeBlockDocument(code, language)
    expect(sourceOf(await original.read({ start: 0, end: code.split('\n').length }))).toBe(code)
  })

  it('reclassifies an earlier slash when an append opens a comment', async () => {
    const doc = await createCodeBlockDocument('const a=1; /', 'ts')
    await doc.read({ start: 0, end: 1 })
    doc.update({
      type: 'edits',
      edits: [
        {
          range: { start: { line: 0, character: 12 }, end: { line: 0, character: 12 } },
          newText: '* comment\nconst hidden = 2;\n*/\nconst visible = 3;'
        }
      ]
    })
    const result = await doc.read({ start: 0, end: 4 })
    expect(sourceOf(result)).toBe(doc.code)
    expect(
      result.lines[1].some((token) => token.content.includes('hidden') && token.className === 'code-syntax-comment')
    ).toBe(true)
    expect(
      result.lines[3].some((token) => token.content === 'const' && token.className === 'code-syntax-keyword')
    ).toBe(true)
  })

  it('uses preceding syntax context when reading a distant viewport and after replacement', async () => {
    const code = '/* open\n' + 'comment\n'.repeat(4000) + '*/\nconst visible = 3;\n'
    const doc = await createCodeBlockDocument(code, 'ts')
    const result = await doc.read({ start: 4000, end: 4003 })
    expect(result.lines[0].every((token) => token.className === 'code-syntax-comment')).toBe(true)
    expect(
      result.lines[2].some((token) => token.content === 'const' && token.className === 'code-syntax-keyword')
    ).toBe(true)
    doc.update({ type: 'replace', code: 'const fresh = "next";\n' })
    expect(sourceOf(await doc.read({ start: 0, end: 2 }))).toBe('const fresh = "next";\n')
  })

  it('retains complete unsupported and long-line source', async () => {
    const code = '你好 🥟\r\n' + 'x'.repeat(1024 * 1024) + '  \n\n'
    const doc = await createCodeBlockDocument(code, 'unsupported-language')
    expect(sourceOf(await doc.read({ start: 0, end: 4 }))).toBe(code)
  })
})
