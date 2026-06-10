import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import type { MessageListItem } from '../../types'
import {
  createSelectedMessageExportViews,
  getOrderedSelectedMessageIds,
  getSelectedMessagesPlainText
} from '../messageSelection'

const createMessage = (id: string, role: MessageListItem['role'] = 'assistant'): MessageListItem => ({
  id,
  role,
  topicId: 'topic-1',
  parentId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'success'
})

describe('messageSelection', () => {
  it('orders selected ids by visible message order and keeps unknown ids at the end', () => {
    const messages = [createMessage('a'), createMessage('b'), createMessage('c')]

    expect(getOrderedSelectedMessageIds(['c', 'missing', 'a'], messages)).toEqual(['a', 'c', 'missing'])
  })

  it('creates export views with parts in visible message order', () => {
    const messages = [createMessage('a', 'user'), createMessage('b')]
    const partsByMessageId: Record<string, CherryMessagePart[]> = {
      a: [{ type: 'text', text: 'prompt' }],
      b: [{ type: 'text', text: 'reply' }]
    }

    const views = createSelectedMessageExportViews(['b', 'a'], messages, partsByMessageId)

    expect(views.map((message) => message.id)).toEqual(['a', 'b'])
    expect(views[0].parts).toEqual(partsByMessageId.a)
    expect(views[1].parts).toEqual(partsByMessageId.b)
  })

  it('copies selected message text in visible message order', () => {
    const messages = [createMessage('a'), createMessage('b')]
    const partsByMessageId: Record<string, CherryMessagePart[]> = {
      a: [{ type: 'text', text: 'first' }],
      b: [{ type: 'text', text: 'second' }]
    }

    expect(getSelectedMessagesPlainText(['b', 'a'], messages, partsByMessageId)).toBe('first\n\n---\n\nsecond')
  })

  it('copies composer skill tokens as pasteable markers instead of hidden prompt text', () => {
    const messages = [createMessage('a', 'user')]
    const partsByMessageId: Record<string, CherryMessagePart[]> = {
      a: [
        {
          type: 'text',
          text: 'Use the pdf skill. hello',
          providerMetadata: {
            cherry: {
              composer: {
                version: 1,
                tokens: [
                  {
                    id: 'skill:pdf',
                    kind: 'skill',
                    label: 'pdf',
                    index: 0,
                    textOffset: 0,
                    promptText: 'Use the pdf skill.'
                  }
                ]
              }
            }
          }
        }
      ]
    }

    expect(getSelectedMessagesPlainText(['a'], messages, partsByMessageId)).toBe('/pdf/ hello')
  })

  it('copies composer knowledge tokens as pasteable id markers', () => {
    const messages = [createMessage('a', 'user')]
    const partsByMessageId: Record<string, CherryMessagePart[]> = {
      a: [
        {
          type: 'text',
          text: 'hello',
          providerMetadata: {
            cherry: {
              composer: {
                version: 1,
                tokens: [
                  {
                    id: 'knowledge:kb-1',
                    kind: 'knowledge',
                    label: 'Docs',
                    index: 0,
                    textOffset: 0
                  }
                ]
              }
            }
          }
        }
      ]
    }

    expect(getSelectedMessagesPlainText(['a'], messages, partsByMessageId)).toBe('#kb-1#hello')
  })

  it('copies quote token messages with the underlying quote text intact', () => {
    const messages = [createMessage('a', 'user')]
    const quotedPromptText = '<blockquote>\n\nSelected message text\n</blockquote>'
    const partsByMessageId: Record<string, CherryMessagePart[]> = {
      a: [
        {
          type: 'text',
          text: `${quotedPromptText} Reply`,
          providerMetadata: {
            cherry: {
              composer: {
                version: 1,
                tokens: [
                  {
                    id: 'quote-1',
                    kind: 'quote',
                    label: 'Quote',
                    description: 'Selected message text',
                    index: 0,
                    textOffset: 0,
                    promptText: quotedPromptText
                  }
                ]
              }
            }
          }
        }
      ]
    }

    expect(getSelectedMessagesPlainText(['a'], messages, partsByMessageId)).toBe(`${quotedPromptText} Reply`)
  })
})
