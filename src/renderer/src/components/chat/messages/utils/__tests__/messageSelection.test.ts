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
})
