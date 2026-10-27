// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { codeBlockToHtml, createCodeBlockSnapshotExecutor, getCodeBlockPalette } from '../../../code-block'
import { loadCodeTheme } from '../../../code-highlight'

const code = '// 中文 🥟\r\nconst html = "<b>&";  \r\n\r\n'
describe('shared code snapshots', () => {
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
