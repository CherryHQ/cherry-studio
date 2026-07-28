import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { resolveMessageCitations, withToolCitationTags } from '../messageCitations'

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

  it('ignores tool parts that have not completed', () => {
    const mc = resolveMessageCitations([webToolPart(undefined, 'input-available'), textPart('hi')])
    expect(mc.all).toHaveLength(0)
  })
})

describe('withToolCitationTags', () => {
  it('maps [cite:id] markers to sup tags and reports the cited subset in order', () => {
    const mc = resolveMessageCitations([webToolPart(webResults('abc')), kbToolPart(kbResults('kzz'))])
    const { content, cited } = withToolCitationTags('B fact. [cite:abc-2] KB fact. [cite:kzz-1] Again [cite:abc-2]', mc)
    expect(content).toContain('2</sup>](https://b.com/y)')
    expect(content).toContain('3</sup>]()')
    expect(cited.map((c) => c.number)).toEqual([2, 3])
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
