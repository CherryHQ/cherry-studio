import type { Element, Root } from 'hast'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import {
  BARE_FILE_PATH_PROPERTY,
  type BareFilePathPlatform,
  findBareFilePathMatches,
  rehypeBareFilePaths
} from '../rehypeBareFilePaths'

const paths = (value: string, platform: BareFilePathPlatform) =>
  findBareFilePathMatches(value, platform).map((match) => match.path)

function transform(tree: Root, platform: BareFilePathPlatform): Root {
  return unified().use(rehypeBareFilePaths, { platform }).runSync(tree)
}

function collectMarkers(node: Root | Element): Element[] {
  const markers: Element[] = []
  for (const child of node.children) {
    if (child.type !== 'element') continue
    if (child.properties?.[BARE_FILE_PATH_PROPERTY] !== undefined) markers.push(child)
    markers.push(...collectMarkers(child))
  }
  return markers
}

describe('findBareFilePathMatches', () => {
  it('finds POSIX and home paths while preserving Unicode and trimming sentence punctuation', () => {
    expect(paths('Saved /Users/lee/桌面/report.pdf，then ~/Downloads/archive.zip.', 'posix')).toEqual([
      '/Users/lee/桌面/report.pdf',
      '~/Downloads/archive.zip'
    ])
  })

  it('keeps sentence punctuation inside an unquoted filename', () => {
    expect(paths('Saved /tmp/report,final.txt and /tmp/report.v2-final.txt.', 'posix')).toEqual([
      '/tmp/report,final.txt',
      '/tmp/report.v2-final.txt'
    ])
  })

  it('recognizes spaces in an unquoted POSIX path when the continuation is path-like', () => {
    expect(paths("Open “/Users/lee/My Project/report.pdf” or '~/My Folder'.", 'posix')).toEqual([
      '/Users/lee/My Project/report.pdf',
      '~/My Folder'
    ])
    expect(paths('Open /Users/lee/My Project/report.pdf', 'posix')).toEqual(['/Users/lee/My Project/report.pdf'])
  })

  it('keeps a complete file path before another filename-like token', () => {
    expect(paths('Generated /tmp/report.pdf README.md', 'posix')).toEqual(['/tmp/report.pdf'])
  })

  it('does not emit a valid prefix for an unquoted directory path with spaces', () => {
    expect(paths('Open /Users/lee/My Project now', 'posix')).toEqual([])
  })

  it('does not join a dotfile with the following filename-like token', () => {
    expect(paths('Open /tmp/.env README.md', 'posix')).toEqual(['/tmp/.env'])
  })

  it('keeps paths followed by line and tab boundaries', () => {
    expect(paths('/tmp/first.txt\n/tmp/second.txt\t~/third.txt', 'posix')).toEqual([
      '/tmp/first.txt',
      '/tmp/second.txt',
      '~/third.txt'
    ])
  })

  it('does not confuse ordinary lowercase get prose with an HTTP method', () => {
    expect(paths('Please get /Users/lee/report.pdf', 'posix')).toEqual(['/Users/lee/report.pdf'])
  })

  it('finds Windows drive, UNC, and home paths', () => {
    expect(
      paths(
        String.raw`Saved C:\Users\lee\report.pdf, \\server\share\项目.txt。 Then ~\Desktop\a.txt or ~/Desktop/b.txt`,
        'windows'
      )
    ).toEqual([
      String.raw`C:\Users\lee\report.pdf`,
      String.raw`\\server\share\项目.txt`,
      String.raw`~\Desktop\a.txt`,
      '~/Desktop/b.txt'
    ])
  })

  it('keeps Windows source locations attached to drive and UNC paths', () => {
    expect(paths(String.raw`Open C:\Users\lee\report.ts:10:2 or \\server\share\report.ts:42.`, 'windows')).toEqual([
      String.raw`C:\Users\lee\report.ts:10:2`,
      String.raw`\\server\share\report.ts:42`
    ])
  })

  it('recognizes Cherry navigation routes on Windows', () => {
    expect(paths('Open /app/chat and /settings/mcp/servers.', 'windows')).toEqual([
      '/app/chat',
      '/settings/mcp/servers'
    ])
  })

  it('uses only the current platform path forms', () => {
    expect(paths(String.raw`/Users/lee/a.txt C:\Users\lee\b.txt`, 'posix')).toEqual(['/Users/lee/a.txt'])
    expect(paths(String.raw`/Users/lee/a.txt C:\Users\lee\b.txt`, 'windows')).toEqual([String.raw`C:\Users\lee\b.txt`])
  })

  it.each([
    'src/renderer/index.ts',
    'https://example.com/Users/lee/report.pdf',
    'file:///Users/lee/report.pdf',
    'prefix/Users/lee/report.pdf',
    '/Users/lee/a\u0000b',
    'GET /api/v1/users',
    'regex /foo/bar',
    'regexp: /foo/bar/g',
    '正则表达式 /foo/bar'
  ])('rejects non-file or unsafe POSIX text: %s', (value) => {
    expect(paths(value, 'posix')).toEqual([])
  })

  it('keeps valid Linux paths that overlap application route prefixes', () => {
    expect(paths('Open /app/config.json, /settings/backup/config.json, /api/v1/users, or /foo/bar', 'posix')).toEqual([
      '/app/config.json',
      '/settings/backup/config.json',
      '/api/v1/users',
      '/foo/bar'
    ])
  })

  it('preserves balanced closing brackets as part of the path', () => {
    const source = 'Open (/tmp/report(final)[v2]). 保存（/Users/lee/报告.pdf）。 Then "/tmp/report)."'
    const matches = findBareFilePathMatches(source, 'posix')

    expect(matches.map((match) => match.path)).toEqual([
      '/tmp/report(final)[v2]',
      '/Users/lee/报告.pdf',
      '/tmp/report).'
    ])
    for (const match of matches) expect(source.slice(match.start, match.end)).toBe(match.path)
  })

  it('does not rescan every nested slash in one long invalid token', () => {
    const input = `${'/./a'.repeat(20_000)} ${'“/bad '.repeat(20_000)}`
    const startedAt = performance.now()

    expect(paths(input, 'posix')).toEqual([])
    expect(performance.now() - startedAt).toBeLessThan(2_000)
  })
})

describe('rehypeBareFilePaths', () => {
  it('marks ordinary text while preserving all surrounding text', () => {
    const tree = transform(
      {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            properties: {},
            children: [{ type: 'text', value: 'Open /Users/lee/a.txt now.' }]
          }
        ]
      },
      'posix'
    )

    const paragraph = tree.children[0] as Element
    expect(paragraph.children).toEqual([
      { type: 'text', value: 'Open ' },
      {
        type: 'element',
        tagName: 'span',
        properties: { [BARE_FILE_PATH_PROPERTY]: '/Users/lee/a.txt' },
        children: [{ type: 'text', value: '/Users/lee/a.txt' }]
      },
      { type: 'text', value: ' now.' }
    ])
  })

  it('skips protected subtrees and remains idempotent', () => {
    const protectedTags = ['a', 'code', 'pre', 'span', 'style', 'script', 'svg', 'math']
    const tree: Root = {
      type: 'root',
      children: [
        ...protectedTags.map((tagName) => ({
          type: 'element' as const,
          tagName,
          properties: {},
          children: [{ type: 'text' as const, value: '/Users/lee/a.txt' }]
        })),
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['katex-display'] },
          children: [{ type: 'text', value: '/Users/lee/math.txt' }]
        }
      ]
    }

    const once = transform(tree, 'posix')
    expect(collectMarkers(once)).toHaveLength(0)

    const ordinary = transform({ type: 'root', children: [{ type: 'text', value: '/Users/lee/a.txt' }] }, 'posix')
    const twice = transform(ordinary, 'posix')
    expect(collectMarkers(twice).map((node) => node.properties?.[BARE_FILE_PATH_PROPERTY])).toEqual([
      '/Users/lee/a.txt'
    ])
  })

  it('does not linkify text inside inline raw HTML elements', () => {
    const tree = transform(
      {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: {},
            children: [{ type: 'text', value: '/Users/lee/raw.txt' }]
          }
        ]
      },
      'posix'
    )

    expect(collectMarkers(tree)).toHaveLength(0)
    expect((tree.children[0] as Element).children).toEqual([{ type: 'text', value: '/Users/lee/raw.txt' }])
  })
})
