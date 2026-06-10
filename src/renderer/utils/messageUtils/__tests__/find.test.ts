import type { MessageExportView } from '@renderer/types/messageExport'
import { MessageBlockType } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import { findAllBlocks, getMainTextContent } from '../find'

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
  it('projects visible custom data parts into export blocks', () => {
    const message = createExportView([
      { type: 'data-code', data: { content: 'const answer = 42', language: 'ts' } },
      { type: 'data-error', data: { name: 'Error', message: 'Something failed', code: 'E_FAILED' } },
      { type: 'data-translation', data: { content: 'Translated answer', targetLanguage: 'en' } }
    ] as MessageExportView['parts'])

    const blocks = findAllBlocks(message)

    expect(blocks.map((block) => block.type)).toEqual([
      MessageBlockType.CODE,
      MessageBlockType.ERROR,
      MessageBlockType.TRANSLATION
    ])
    expect(blocks[0]).toMatchObject({ type: MessageBlockType.CODE, content: 'const answer = 42', language: 'ts' })
    expect(blocks[1]).toMatchObject({ type: MessageBlockType.ERROR, error: { message: 'Something failed' } })
    expect(blocks[2]).toMatchObject({
      type: MessageBlockType.TRANSLATION,
      content: 'Translated answer',
      targetLanguage: 'en'
    })
  })

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
