import type { MessageExportView } from '@renderer/types/messageExport'
import { MessageBlockType } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import { findAllBlocks, getMainTextContent, getNamingTextContent } from '../find'

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
  it('synthesises CODE / ERROR / TRANSLATION blocks from data-* parts', () => {
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

  it('emits no blocks for a v1 message that carries no parts (Save-to-Knowledge stays inert)', () => {
    // v1 messages reach this path with `parts: []` — the data-* branches must not fire.
    expect(findAllBlocks(createExportView([]))).toEqual([])
  })

  it('includes the data-* text in plain export content', () => {
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
