// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { codeBlockToHtml, createCodeBlockSnapshotExecutor, getCodeBlockPalette } from '../../../code-block'
import { loadCodeTheme } from '../../../code-highlight'

const code = '// 中文 🥟\r\nconst html = "<b>&";  \r\n\r\n'
describe('shared code snapshots', () => {
  it.each([
    ['jsonc', '{ "html": "<b>& 🥟", "count": 42 }\r\n'],
    ['shellscript', 'echo "<b>& 🥟" # comment\r\n'],
    ['clojure', '(def html "<b>& 🥟")\r\n'],
    ['haskell', 'html = "<b>& 🥟"\r\n'],
    ['powershell', 'Write-Host "<b>& 🥟"\r\n'],
    ['perl', 'print "<b>& 🥟";\r\n']
  ])('exports %s aliases with syntax colors and exact escaped source', async (language, code) => {
    const html = await codeBlockToHtml(code, language, 'one-light')
    const node = document.createElement('div')
    node.innerHTML = html
    expect(node.querySelector('code')?.textContent).toBe(code)
    expect(node.querySelector('b')).toBeNull()
    const string = Array.from(node.querySelectorAll('span')).find((span) => span.textContent === '"<b>& 🥟"')
    expect(string).toBeDefined()
    expect(string?.style.color).not.toBe(node.querySelector('pre')?.style.color)
  })

  it('exports a canonical LaTeX command with syntax and escaped source', async () => {
    const code = '\\textbf{<b>& 🥟}\r\n'
    const node = document.createElement('div')
    node.innerHTML = await codeBlockToHtml(code, 'latex', 'one-light')
    expect(node.querySelector('code')?.textContent).toBe(code)
    expect(node.querySelector('b')).toBeNull()
    const command = Array.from(node.querySelectorAll('span')).find((span) => span.textContent === '\\textbf')
    expect(command).toBeDefined()
    expect(command?.style.color).not.toBe(node.querySelector('pre')?.style.color)
  })

  it('uses semantic palette colors and preserves exact source and offsets in both themes', async () => {
    const execute = createCodeBlockSnapshotExecutor()
    const request = { code, language: 'ts', themes: ['one-light', 'nord'] as [string, string] }
    const pending = execute(request)
    expect(execute(request)).toBe(pending)
    const result = await pending
    expect(result.tokens.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(code)
    const keyword = result.tokens[1].find((token) => token.content === 'const')!
    const light = getCodeBlockPalette(await loadCodeTheme('one-light'))
    const dark = getCodeBlockPalette(await loadCodeTheme('nord'))
    expect(keyword.color).toBe(light['--code-syntax-keyword'])
    expect(keyword.htmlStyle?.['--shiki-dark']).toBe(dark['--code-syntax-keyword'])
    expect(keyword.offset).toBe(0)
    expect(result.tokens[0][0].htmlStyle?.['font-style']).toBe(light['--code-syntax-comment-style'])
  })

  it('escapes exported code while retaining all lines and whitespace', async () => {
    const html = await codeBlockToHtml(code, 'ts', 'one-light')
    const node = document.createElement('div')
    node.innerHTML = html
    expect(node.querySelector('code')?.textContent).toBe(code)
    expect(node.querySelector('b')).toBeNull()
    expect(node.querySelector('pre')?.style.color).not.toBe('')
  })
})
