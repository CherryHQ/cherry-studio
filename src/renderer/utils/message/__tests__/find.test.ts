import type { MessageExportView } from '@renderer/types/messageExport'
import { describe, expect, it } from 'vitest'

import { getMainTextContent, getNamingTextContent } from '../find'

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
  it('includes visible custom data parts in plain export content', () => {
    const message = createExportView([
      { type: 'text', text: 'Main answer' },
      { type: 'data-code', data: { content: 'console.log("ok")', language: 'ts' } },
      { type: 'data-error', data: { message: 'Request failed' } },
      { type: 'data-translation', data: { content: 'Translated answer', targetLanguage: 'en' } }
    ] as MessageExportView['parts'])

    expect(getMainTextContent(message)).toBe(
      ['Main answer', '```ts\nconsole.log("ok")\n```', 'Request failed', 'Translated answer'].join('\n\n')
    )
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

  it('getNamingTextContent drops error and translation parts but keeps text and code', () => {
    const message = createExportView([
      { type: 'text', text: 'Main answer' },
      { type: 'data-code', data: { content: 'console.log("ok")', language: 'ts' } },
      { type: 'data-error', data: { name: 'HttpError', code: '401', message: 'Unauthorized' } },
      { type: 'data-translation', data: { content: 'Translated answer', targetLanguage: 'en' } }
    ] as MessageExportView['parts'])

    expect(getNamingTextContent(message)).toBe(['Main answer', '```ts\nconsole.log("ok")\n```'].join('\n\n'))
  })
})
