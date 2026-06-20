import type { MessageExportView } from '@renderer/types/messageExport'
import { describe, expect, it } from 'vitest'

import { getMainTextContent } from '../find'

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

describe('messageUtils/find', () => {
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
})
