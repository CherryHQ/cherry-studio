import { describe, expect, it } from 'vitest'

import { buildSearchSnippet, stripMarkdownFormatting } from '../searchSnippet'

describe('searchSnippet', () => {
  it('strips markdown before snippet matching', () => {
    const snippet = buildSearchSnippet(
      [
        '# Heading',
        'Before the match',
        '**needle** appears in [docs](https://example.com) with `code` and <span>markup</span>.'
      ].join('\n'),
      ['needle'],
      'substring'
    )

    expect(stripMarkdownFormatting('**needle** [docs](https://example.com) `code` <span>markup</span>')).toBe(
      'needle docs code markup'
    )
    expect(snippet).toContain('needle appears in docs with code and markup.')
    expect(snippet).not.toContain('**needle**')
    expect(snippet).not.toContain('https://example.com')
  })

  it('fragments long lines around search matches', () => {
    const line = `${'a'.repeat(90)}needle${'b'.repeat(90)}target${'c'.repeat(90)}`

    const snippet = buildSearchSnippet(line, ['needle', 'target'], 'substring')

    expect(snippet).toContain('needle')
    expect(snippet).toContain('target')
    expect(snippet).toContain(' ... ')
    expect(snippet.startsWith('...')).toBe(true)
    expect(snippet.endsWith('...')).toBe(true)
    expect(snippet.length).toBeLessThanOrEqual(163)
  })

  it('adds ellipsis between non-adjacent matched line windows', () => {
    const snippet = buildSearchSnippet(
      ['before one', 'needle one', 'after one', 'gap one', 'gap two', 'before two', 'needle two', 'after two'].join(
        '\n'
      ),
      ['needle'],
      'substring'
    )

    expect(snippet).toBe(
      ['before one', 'needle one', 'after one', '...', 'before two', 'needle two', 'after two'].join('\n')
    )
  })

  it('truncates fallback snippets when no terms are provided', () => {
    const snippet = buildSearchSnippet(
      Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n'),
      [],
      'substring'
    )

    expect(snippet.split('\n')).toEqual([
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10',
      'line 11',
      'line 12',
      '...'
    ])
  })

  it('keeps hashes inside the text when stripping markdown', () => {
    expect(stripMarkdownFormatting('我在用 C# 写一个爬虫')).toBe('我在用 C# 写一个爬虫')
    expect(stripMarkdownFormatting('F# 语言教程')).toBe('F# 语言教程')
    expect(stripMarkdownFormatting('标签 # 待办事项')).toBe('标签 # 待办事项')
    expect(stripMarkdownFormatting('####### 七个井号不是标题')).toBe('####### 七个井号不是标题')
  })

  it('strips ATX headings only at line start', () => {
    expect(stripMarkdownFormatting('# 标题一\n## 标题二\n正文')).toBe('标题一\n标题二\n正文')
    expect(stripMarkdownFormatting('###### 六级标题')).toBe('六级标题')
  })

  it('keeps messages searchable when the content contains hashes', () => {
    const message = '我在用 C# 写一个爬虫'

    const snippet = buildSearchSnippet(message, ['C#'], 'substring')

    expect(snippet).toContain('C#')
  })
})
