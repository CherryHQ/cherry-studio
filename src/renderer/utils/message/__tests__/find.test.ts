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
    const message = createExportView([
      { type: 'source-url', sourceId: 'citation-1', url: 'https://second.com' },
      {
        type: 'text',
        text: 'Legacy answer [2]',
        providerMetadata: {
          cherry: { references: [{ category: 'citation', number: 2, url: 'https://second.com', title: 'Second' }] }
        }
      }
    ] as MessageExportView['parts'])

    expect(getToolCitationExport(message, 'Legacy answer [2]')).toEqual({ content: 'Legacy answer [2]', citation: '' })
  })
})
