import type { MessageExportView } from '@renderer/types/messageExport'
import { describe, expect, it } from 'vitest'

import { getMainTextContent, getNamingTextContent, getToolCitationExport } from '../find'

function createExportView(parts: MessageExportView['parts']): MessageExportView {
  return {
    id: 'message-1',
    role: 'assistant',
    topicId: 'topic-1',
    createdAt: '2024-01-01T00:00:00Z',
    status: 'success',
    parts
  }
}

describe('message/find', () => {
  it('includes visible custom data parts in exports while excluding auxiliary content from naming', () => {
    const message = createExportView([
      { type: 'text', text: 'Main answer' },
      { type: 'data-code', data: { content: 'console.log("ok")', language: 'ts' } },
      { type: 'data-error', data: { message: 'Request failed' } },
      { type: 'data-translation', data: { content: 'Translated answer', targetLanguage: 'en' } }
    ] as MessageExportView['parts'])

    expect(getMainTextContent(message)).toBe(
      ['Main answer', '```ts\nconsole.log("ok")\n```', 'Request failed', 'Translated answer'].join('\n\n')
    )
    expect(getNamingTextContent(message)).toBe(['Main answer', '```ts\nconsole.log("ok")\n```'].join('\n\n'))
  })

  it('joins all three error fields (name, code, message) in order', () => {
    const message = createExportView([
      { type: 'data-error', data: { name: 'HttpError', code: '401', message: 'Unauthorized' } }
    ] as MessageExportView['parts'])

    expect(getMainTextContent(message)).toBe('HttpError\n401\nUnauthorized')
  })

  it('omits a code part whose content is empty or whitespace', () => {
    const message = createExportView([
      { type: 'text', text: 'Answer' },
      { type: 'data-code', data: { content: '   ', language: 'ts' } }
    ] as MessageExportView['parts'])

    expect(getMainTextContent(message)).toBe('Answer')
  })
})

describe('getToolCitationExport', () => {
  it('rewrites tool-part markers and lists their sources', () => {
    const message = createExportView([
      {
        type: 'tool-web_search',
        toolCallId: 'c1',
        state: 'output-available',
        input: { query: 'q' },
        output: [{ id: '3f2a1b9c-1', title: 'Example', url: 'https://example.com', content: 'snippet' }]
      },
      { type: 'text', text: 'Fact. [cite:3f2a1b9c-1]' }
    ] as MessageExportView['parts'])

    expect(getToolCitationExport(message, 'Fact. [cite:3f2a1b9c-1]')).toEqual({
      content: 'Fact. [1]',
      citation: '[1] [Example](https://example.com)'
    })
  })

  it('uses the same message-wide sequence across multiple text parts', () => {
    const message = createExportView([
      {
        type: 'tool-web_search',
        toolCallId: 'c1',
        state: 'output-available',
        input: { query: 'q' },
        output: [
          { id: 'call-1', title: 'First', url: 'https://first.example', content: 'first' },
          { id: 'call-2', title: 'Second', url: 'https://second.example', content: 'second' }
        ]
      },
      { type: 'text', text: 'Later source first. [cite:call-2]' },
      { type: 'text', text: 'Earlier source second. [cite:call-1]' }
    ] as MessageExportView['parts'])
    const content = getMainTextContent(message)

    expect(getToolCitationExport(message, content)).toEqual({
      content: 'Later source first. [1]\n\nEarlier source second. [2]',
      citation: '[1] [Second](https://second.example)\n\n[2] [First](https://first.example)'
    })
  })

  it('lists a URL-less knowledge citation without a link', () => {
    const message = createExportView([
      {
        type: 'tool-kb_search',
        toolCallId: 'c2',
        state: 'output-available',
        input: { query: 'q', baseIds: ['b'] },
        output: [{ id: '3f2a1b9c-1', baseId: 'b', conceptId: 'notes/one.md', title: 'One.md', content: 'kb', score: 1 }]
      },
      { type: 'text', text: 'From notes. [cite:3f2a1b9c-1]' }
    ] as MessageExportView['parts'])

    expect(getToolCitationExport(message, 'From notes. [cite:3f2a1b9c-1]').citation).toBe('[1] One.md')
  })

  it('defers to legacy reference metadata rather than renumbering it', () => {
    // Migrated v1 messages number their `[N]` markers from the stored references;
    // re-resolving would renumber by first appearance and drift from that list.
    //
    // The reference uses the real nested `WebCitationReference` shape the v1 migrator emits
    // (`content.results`, no top-level `url`) — a flat `{ url }` reference would let the guard
    // pass for the wrong reason, since `getCitationContent` only reads the flat form.
    const message = createExportView([
      { type: 'source-url', sourceId: 'citation-1', url: 'https://first.com' },
      { type: 'source-url', sourceId: 'citation-2', url: 'https://second.com' },
      { type: 'source-url', sourceId: 'citation-3', url: 'https://third.com' },
      {
        type: 'text',
        text: 'Legacy answer [3] and [1]',
        providerMetadata: {
          cherry: {
            references: [
              {
                category: 'citation',
                citationType: 'web',
                content: {
                  results: [
                    { url: 'https://first.com', title: 'First' },
                    { url: 'https://second.com', title: 'Second' },
                    { url: 'https://third.com', title: 'Third' }
                  ]
                }
              }
            ]
          }
        }
      }
    ] as MessageExportView['parts'])

    // Untouched: renumbering by first appearance would rewrite this to "[1] and [2]", which no
    // longer matches the numbers the message renders on screen.
    expect(getToolCitationExport(message, 'Legacy answer [3] and [1]')).toEqual({
      content: 'Legacy answer [3] and [1]',
      citation: ''
    })
  })

  it('still resolves markers when reference metadata is present but yields no citations', () => {
    // Mirrors MainTextBlock, which falls through to tool citations on `citations.length === 0` —
    // an empty or non-citation reference list must not strand `[cite:id]` in the export.
    const message = createExportView([
      { type: 'source-url', sourceId: 'citation-1', url: 'https://a.com', title: 'A' },
      { type: 'source-url', sourceId: 'citation-2', url: 'https://b.com', title: 'B' },
      {
        type: 'text',
        // `citation-N` sourceIds are 0-indexed on the wire, so `citation-2` is marker [3].
        text: 'Claim [3]',
        providerMetadata: { cherry: { references: [{ category: 'metadata' }] } }
      }
    ] as MessageExportView['parts'])

    expect(getToolCitationExport(message, 'Claim [3]')).toEqual({
      content: 'Claim [1]',
      citation: '[1] [B](https://b.com)'
    })
  })
})

describe('getToolCitationExport across turns', () => {
  it('resolves a marker against priorCitationParts and lists that source', () => {
    const message: MessageExportView = {
      ...createExportView([{ type: 'text', text: 'Prices rose. [cite:3f2a1b9c-2]' }] as MessageExportView['parts']),
      priorCitationParts: [
        {
          type: 'tool-web_search',
          toolCallId: 'earlier-turn',
          state: 'output-available',
          input: { query: 'q' },
          output: [
            { id: '3f2a1b9c-1', title: 'First', url: 'https://a.com/x', content: 'alpha' },
            { id: '3f2a1b9c-2', title: 'Second', url: 'https://b.com/y', content: 'beta' }
          ]
        }
      ] as MessageExportView['parts']
    }

    const { content, citation } = getToolCitationExport(message, 'Prices rose. [cite:3f2a1b9c-2]')

    expect(content).toBe('Prices rose. [1]')
    expect(citation).toBe('[1] [Second](https://b.com/y)')
  })
})
