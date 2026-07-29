import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { resolveMessageCitations, toExportableCitations, withToolCitationTags } from '../citations'

const webResults = (prefix: string) => [
  { id: `${prefix}-1`, title: 'First', url: 'https://a.com/x', content: 'alpha *bold*' },
  { id: `${prefix}-2`, title: 'Second', url: 'https://b.com/y', content: 'beta' }
]

const kbResults = (prefix: string) => [
  { id: `${prefix}-1`, conceptId: 'doc/one.md', title: 'One.md', type: 'file', content: 'kb chunk', score: 0.9 }
]

const webToolPart = (results: unknown, state = 'output-available'): CherryMessagePart =>
  ({ type: 'tool-web_search', toolCallId: 'c1', state, input: { query: 'q' }, output: results }) as never

const kbToolPart = (results: unknown): CherryMessagePart =>
  ({
    type: 'tool-kb_search',
    toolCallId: 'c2',
    state: 'output-available',
    input: { query: 'q', baseIds: ['b'] },
    output: results
  }) as never

const kbReadPart = (output: unknown, toolCallId = 'c5'): CherryMessagePart =>
  ({
    type: 'tool-kb_read',
    toolCallId,
    state: 'output-available',
    input: { baseId: 'b', conceptId: 'doc/two.md' },
    output
  }) as never

const kbReadOutput = (id: string | undefined, overrides: Record<string, unknown> = {}) => ({
  ...(id === undefined ? {} : { id }),
  conceptId: 'doc/two.md',
  title: 'Two.md',
  type: 'file',
  totalChars: 10,
  charStart: 0,
  charEnd: 10,
  content: 'read slice',
  truncated: false,
  ...overrides
})

const kbGrepOutput = (id: string) => ({
  id,
  conceptId: 'doc/three.md',
  title: 'Three.md',
  type: 'file',
  totalMatches: 2,
  matches: [
    { line: 3, charStart: 10, charEnd: 20, snippet: 'first hit' },
    { line: 9, charStart: 40, charEnd: 50, snippet: 'second hit' }
  ]
})

const dynamicMcpPart = (toolName: string, content: unknown): CherryMessagePart =>
  ({
    type: 'dynamic-tool',
    toolName,
    toolCallId: 'c3',
    state: 'output-available',
    input: { query: 'q' },
    output: { content, metadata: { type: 'mcp', serverName: 'cherry-tools' } }
  }) as never

const toolInvokePart = (name: string, output: unknown): CherryMessagePart =>
  ({
    type: 'tool-tool_invoke',
    toolCallId: 'c4',
    state: 'output-available',
    input: { name, params: { query: 'q' } },
    output
  }) as never

const sourceUrlPart = (n: number, url: string, title?: string): CherryMessagePart =>
  ({ type: 'source-url', sourceId: `citation-${n}`, url, title }) as never

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text }) as never

describe('resolveMessageCitations', () => {
  it('resolves static assistant tool parts with sequential display numbers', () => {
    const mc = resolveMessageCitations([webToolPart(webResults('abc')), kbToolPart(kbResults('kzz'))])
    expect(mc.all.map((c) => c.number)).toEqual([1, 2, 3])
    expect(mc.byId.get('abc-1')).toMatchObject({ number: 1, url: 'https://a.com/x', type: 'websearch' })
    expect(mc.byId.get('kzz-1')).toMatchObject({ number: 3, title: 'One.md', url: '', type: 'knowledge' })
  })

  it('resolves agent dynamic-tool parts with MCP-wrapped output', () => {
    const mc = resolveMessageCitations([dynamicMcpPart('mcp__cherry-tools__kb_search', kbResults('qqq'))])
    expect(mc.byId.get('qqq-1')).toMatchObject({ type: 'knowledge', content: 'kb chunk' })
  })

  it('ignores third-party MCP tools sharing the builtin name', () => {
    const mc = resolveMessageCitations([dynamicMcpPart('mcp__other-server__web_search', webResults('abc'))])
    expect(mc.all).toHaveLength(0)
  })

  it('resolves deferred tool_invoke parts by inner tool name', () => {
    const mc = resolveMessageCitations([toolInvokePart('web_search', webResults('t9k'))])
    expect(mc.byId.get('t9k-2')).toMatchObject({ number: 2, url: 'https://b.com/y' })
  })

  it('collects provider-native source-url parts keyed by their marker numbers', () => {
    const mc = resolveMessageCitations([sourceUrlPart(0, 'https://s.com/1', 'S1'), sourceUrlPart(1, 'https://s.com/2')])
    expect(mc.byMarkerNumber.get(1)).toMatchObject({ url: 'https://s.com/1', title: 'S1' })
    expect(mc.byMarkerNumber.get(2)).toMatchObject({ url: 'https://s.com/2', title: 's.com' })
  })

  it('skips error outputs and string MCP notes', () => {
    const mc = resolveMessageCitations([
      webToolPart({ error: 'provider down', retryable: true }),
      dynamicMcpPart('mcp__cherry-tools__web_search', 'No matches; refine the query.')
    ])
    expect(mc.all).toHaveLength(0)
  })

  it('parses legacy numeric ids and exposes bare-marker resolution for a single call', () => {
    const mc = resolveMessageCitations([
      webToolPart([{ id: 2, title: 'Old', url: 'https://old.com', content: 'legacy' }])
    ])
    expect(mc.byId.get('2')).toMatchObject({ url: 'https://old.com' })
    expect(mc.byMarkerNumber.get(2)).toBeDefined()
  })

  it('withholds bare-marker resolution when multiple calls make numbers ambiguous', () => {
    const mc = resolveMessageCitations([webToolPart(webResults('aaa')), kbToolPart(kbResults('bbb'))])
    expect(mc.byMarkerNumber.size).toBe(0)
    expect(mc.byId.size).toBe(3)
  })

  it('aliases duplicate URLs across calls to one citation', () => {
    const first = webToolPart(webResults('aaa'))
    const second = {
      ...webToolPart([{ id: 'zzz-1', title: 'Dup', url: 'https://a.com/x', content: 'dup' }]),
      toolCallId: 'c9'
    } as CherryMessagePart
    const mc = resolveMessageCitations([first, second])
    expect(mc.all).toHaveLength(2)
    expect(mc.byId.get('zzz-1')).toBe(mc.byId.get('aaa-1'))
  })

  it('resolves a kb_read slice as one document-level citation', () => {
    const mc = resolveMessageCitations([kbReadPart(kbReadOutput('rrr-1'))])
    expect(mc.all).toHaveLength(1)
    expect(mc.byId.get('rrr-1')).toMatchObject({ number: 1, title: 'Two.md', url: '', type: 'knowledge' })
  })

  it('resolves an MCP-wrapped kb_read slice from the agent path', () => {
    const mc = resolveMessageCitations([dynamicMcpPart('mcp__cherry-tools__kb_read', kbReadOutput('rrr-1'))])
    expect(mc.byId.get('rrr-1')).toMatchObject({ title: 'Two.md', content: 'read slice', type: 'knowledge' })
  })

  it('joins grep match snippets into the citation preview', () => {
    const mc = resolveMessageCitations([kbReadPart(kbGrepOutput('ggg-1'))])
    expect(mc.byId.get('ggg-1')).toMatchObject({ title: 'Three.md', content: 'first hit … second hit' })
  })

  it('truncates a long read slice to a tooltip-sized snippet', () => {
    const mc = resolveMessageCitations([kbReadPart(kbReadOutput('rrr-1', { content: 'x'.repeat(2000) }))])
    expect(mc.byId.get('rrr-1')?.content).toBe(`${'x'.repeat(300)}…`)
  })

  it('aliases a document to its existing citation when kb_search already returned it', () => {
    const mc = resolveMessageCitations([
      kbToolPart(kbResults('sss')),
      kbReadPart(kbReadOutput('rrr-1', { conceptId: 'doc/one.md' }))
    ])
    expect(mc.all).toHaveLength(1)
    expect(mc.byId.get('rrr-1')).toBe(mc.byId.get('sss-1'))
  })

  it('keeps same-path documents from different bases apart', () => {
    // conceptId is a base-relative path, so two bases can each hold a `README.md`.
    // Deduping on it alone aliased the second base's hit onto the first document.
    const mc = resolveMessageCitations([
      kbToolPart([
        { id: 'kkk-1', baseId: 'base-a', conceptId: 'README.md', title: 'README', content: 'from A', score: 0.9 },
        { id: 'kkk-2', baseId: 'base-b', conceptId: 'README.md', title: 'README', content: 'from B', score: 0.8 }
      ])
    ])
    expect(mc.all).toHaveLength(2)
    expect(mc.byId.get('kkk-1')).not.toBe(mc.byId.get('kkk-2'))
    expect(mc.all.map((citation) => citation.content)).toEqual(['from A', 'from B'])
  })

  it('still dedupes one base’s document across a search and a read', () => {
    const mc = resolveMessageCitations([
      kbToolPart([
        { id: 'kkk-1', baseId: 'base-a', conceptId: 'README.md', title: 'README', content: 'chunk', score: 0.9 }
      ]),
      kbReadPart(kbReadOutput('rrr-1', { baseId: 'base-a', conceptId: 'README.md' }))
    ])
    expect(mc.all).toHaveLength(1)
    expect(mc.byId.get('rrr-1')).toBe(mc.byId.get('kkk-1'))
  })

  it('dedupes on conceptId alone for results persisted before baseId existed', () => {
    const mc = resolveMessageCitations([
      kbToolPart([
        { id: 'kkk-1', conceptId: 'README.md', title: 'README', content: 'first', score: 0.9 },
        { id: 'kkk-2', conceptId: 'README.md', title: 'README', content: 'second', score: 0.8 }
      ])
    ])
    expect(mc.all).toHaveLength(1)
  })

  it('drops a later result whose id collides with an earlier one', () => {
    // Citation ids carry 32 bits of per-call entropy so this effectively cannot happen;
    // pin the resolution anyway so a collision degrades predictably (first id wins)
    // rather than silently re-pointing an already-rendered badge.
    const mc = resolveMessageCitations([
      webToolPart([{ id: 'dup-1', title: 'First', url: 'https://a.com/x', content: 'alpha' }]),
      webToolPart([{ id: 'dup-1', title: 'Second', url: 'https://b.com/y', content: 'beta' }])
    ])
    expect(mc.all).toHaveLength(1)
    expect(mc.byId.get('dup-1')?.url).toBe('https://a.com/x')
  })

  it('skips kb_read results persisted before citation ids existed', () => {
    const mc = resolveMessageCitations([kbReadPart(kbReadOutput(undefined))])
    expect(mc.all).toHaveLength(0)
  })

  it('skips kb_read error and no-match outputs', () => {
    const mc = resolveMessageCitations([
      // The assistant path persists the raw core result, the agent path the steer text.
      kbReadPart({ error: 'Knowledge base "b" is not available to this assistant.' }),
      kbReadPart({ ...kbGrepOutput('ggg-1'), totalMatches: 0, matches: [] }, 'c6'),
      kbReadPart('No matches for that pattern in "doc/three.md".', 'c7')
    ])
    expect(mc.all).toHaveLength(0)
  })

  it('ignores tool parts that have not completed', () => {
    const mc = resolveMessageCitations([webToolPart(undefined, 'input-available'), textPart('hi')])
    expect(mc.all).toHaveLength(0)
  })
})

describe('withToolCitationTags', () => {
  it('maps [cite:id] markers to sup tags and reports the cited subset in order', () => {
    const mc = resolveMessageCitations([webToolPart(webResults('abc')), kbToolPart(kbResults('kzz'))])
    const { content, cited } = withToolCitationTags('B fact. [cite:abc-2] KB fact. [cite:kzz-1] Again [cite:abc-2]', mc)
    // Numbered by first appearance, not by position in the result set: abc-2 resolves to the
    // resolver's #2 and kzz-1 to its #3, but they render as 1 and 2.
    expect(content).toContain('1</sup>](https://b.com/y)')
    // Web citations link out; the URL-less KB citation must stay a bare <sup> so rehype-harden
    // does not rewrite an empty-href anchor into "<span>… [blocked]</span>".
    expect(content).toContain('2</sup>')
    expect(content).not.toContain('2</sup>]()')
    expect(cited.map((c) => c.number)).toEqual([1, 2])
    // A repeat of the same source reuses its number instead of taking a new one.
    expect(content.match(/>1<\/sup>/g)).toHaveLength(2)
  })

  it('numbers badges in reading order even when the model cites out of order', () => {
    const mc = resolveMessageCitations([webToolPart(webResults('abc'))])
    // abc-2 is the resolver's #2 and abc-1 its #1, but the text cites the later result first.
    const { content, cited } = withToolCitationTags('First [cite:abc-2] then [cite:abc-1]', mc)

    expect(content.indexOf('>1</sup>')).toBeLessThan(content.indexOf('>2</sup>'))
    // The footer list follows the same order, so badge N is the Nth entry in the panel.
    expect(cited.map((c) => c.number)).toEqual([1, 2])
    expect(cited.map((c) => c.url)).toEqual(['https://b.com/y', 'https://a.com/x'])
  })

  it('collapses adjacent markers that resolve to the same source', () => {
    // Two chunks of one document dedupe to a single citation, so the chained markers the model
    // wrote would otherwise render as the same badge twice.
    const mc = resolveMessageCitations([
      kbToolPart([
        { id: 'sss-1', conceptId: 'doc/one.md', title: 'One.md', type: 'file', content: 'first', score: 0.9 },
        { id: 'sss-2', conceptId: 'doc/one.md', title: 'One.md', type: 'file', content: 'second', score: 0.8 }
      ])
    ])
    const { content, cited } = withToolCitationTags('KB fact. [cite:sss-1][cite:sss-2]', mc)

    expect(content.match(/>1<\/sup>/g)).toHaveLength(1)
    expect(cited).toHaveLength(1)
  })

  it('keeps distinct sources in a chained run', () => {
    const mc = resolveMessageCitations([webToolPart(webResults('abc'))])
    const { content } = withToolCitationTags('Fact. [cite:abc-1] [cite:abc-2]', mc)

    expect(content).toContain('1</sup>](https://a.com/x)')
    expect(content).toContain('2</sup>](https://b.com/y)')
  })

  it('leaves unknown ids literal', () => {
    const mc = resolveMessageCitations([webToolPart(webResults('abc'))])
    const { content, cited } = withToolCitationTags('Fact. [cite:zzz-9]', mc)
    expect(content).toContain('[cite:zzz-9]')
    expect(cited).toHaveLength(0)
  })

  it('promotes bare [N] markers for a single lookup call', () => {
    const mc = resolveMessageCitations([webToolPart([{ id: 1, title: 'Old', url: 'https://old.com', content: 'x' }])])
    const { content, cited } = withToolCitationTags('Old fact. [1]', mc)
    expect(content).toContain('1</sup>](https://old.com)')
    expect(cited).toHaveLength(1)
  })

  it('does not promote bare [N] inside code blocks', () => {
    const mc = resolveMessageCitations([webToolPart([{ id: 1, title: 'Old', url: 'https://old.com', content: 'x' }])])
    const { content } = withToolCitationTags('`arr[1]` and text [1]', mc)
    expect(content).toContain('`arr[1]`')
    expect(content).toContain('1</sup>](https://old.com)')
  })

  it('resolves provider-native [N] markers from source-url parts', () => {
    const mc = resolveMessageCitations([sourceUrlPart(0, 'https://s.com/1', 'S1')])
    const { content, cited } = withToolCitationTags('Grounded fact. [1]', mc)
    expect(content).toContain('1</sup>](https://s.com/1)')
    expect(cited.map((c) => c.title)).toEqual(['S1'])
  })

  it('cleans markdown in tooltip snippets', () => {
    const mc = resolveMessageCitations([webToolPart(webResults('abc'))])
    const { content } = withToolCitationTags('Fact. [cite:abc-1]', mc)
    expect(content).toContain('alpha bold')
    expect(content).not.toContain('alpha *bold*')
  })
})

describe('toExportableCitations', () => {
  it('rewrites markers to plain [N] and reports the cited sources', () => {
    const parts = [webToolPart(webResults('abc'))]
    const { content, cited } = toExportableCitations('First [cite:abc-1] then [cite:abc-2].', parts)

    expect(content).toBe('First [1] then [2].')
    expect(cited.map((c) => c.url)).toEqual(['https://a.com/x', 'https://b.com/y'])
  })

  it('numbers by first appearance, matching the rendered badges', () => {
    const parts = [webToolPart(webResults('abc'))]
    const { content, cited } = toExportableCitations('Later first [cite:abc-2] then [cite:abc-1].', parts)

    expect(content).toBe('Later first [1] then [2].')
    expect(cited.map((c) => c.url)).toEqual(['https://b.com/y', 'https://a.com/x'])
  })

  it('drops a marker whose id resolves to nothing', () => {
    // An internal id must never reach an exported document or the clipboard.
    const { content, cited } = toExportableCitations('Claim [cite:gone-9].', [webToolPart(webResults('abc'))])

    expect(content).toBe('Claim .')
    expect(cited).toEqual([])
  })

  it('strips markers even when the message carries no tool results', () => {
    const { content } = toExportableCitations('Claim [cite:abc-1].', [textPart('hi')])
    expect(content).toBe('Claim .')
  })

  it('collapses repeat markers the way the rendered badges do', () => {
    const parts = [
      kbToolPart([
        { id: 'sss-1', baseId: 'b', conceptId: 'doc/one.md', title: 'One.md', content: 'first', score: 0.9 },
        { id: 'sss-2', baseId: 'b', conceptId: 'doc/one.md', title: 'One.md', content: 'second', score: 0.8 }
      ])
    ]
    const { content, cited } = toExportableCitations('KB fact. [cite:sss-1][cite:sss-2]', parts)

    expect(content).toBe('KB fact. [1]')
    expect(cited).toHaveLength(1)
  })

  it('leaves a message without markers untouched', () => {
    const { content, cited } = toExportableCitations('Plain answer.', [webToolPart(webResults('abc'))])
    expect(content).toBe('Plain answer.')
    expect(cited).toEqual([])
  })
})
