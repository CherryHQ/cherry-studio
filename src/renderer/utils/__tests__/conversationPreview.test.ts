import { describe, expect, it } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { selectConversationPreview } from '../message/conversationPreview'

const question: CherryUIMessage = {
  id: 'question',
  role: 'assistant',
  parts: [
    { type: 'tool-AskUserQuestion', toolCallId: 'q', state: 'approval-requested', approval: { id: 'q' }, input: {} }
  ]
}
const permission: CherryUIMessage = {
  id: 'permission',
  role: 'assistant',
  parts: [
    {
      type: 'tool-Bash',
      toolCallId: 'p',
      state: 'approval-requested',
      approval: { id: 'p' },
      input: { command: 'pwd' }
    }
  ]
}
const reply: CherryUIMessage = { id: 'reply', role: 'assistant', parts: [{ type: 'text', text: 'Latest reply' }] }

describe('selectConversationPreview', () => {
  it('keeps the earliest unanswered request ahead of newer output and counts the remaining requests', () => {
    const preview = selectConversationPreview([question, permission, reply])
    expect(preview.request?.message.id).toBe('question')
    expect(preview.remainingRequests).toBe(1)
    expect(preview.messages.map((m) => m.id)).toEqual(['question'])
  })
  it('keeps the latest user question when multiple assistant chunks follow it', () => {
    const user: CherryUIMessage = { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Question' }] }
    const intermediate: CherryUIMessage = { ...reply, id: 'intermediate' }
    expect(selectConversationPreview([user, intermediate, reply]).messages.map((message) => message.id)).toEqual([
      'user',
      'reply'
    ])
    expect(selectConversationPreview([reply, user]).messages.map((message) => message.id)).toEqual(['user'])
  })
  it('advances after resolution, then returns to the latest conversation tail', () => {
    const answered: CherryUIMessage = {
      ...question,
      parts: [
        {
          type: 'tool-AskUserQuestion',
          toolCallId: 'q',
          state: 'output-available',
          input: {},
          output: { answer: 'Light' }
        }
      ]
    }
    expect(selectConversationPreview([answered, permission, reply]).request?.message.id).toBe('permission')
    const approved: CherryUIMessage = {
      ...permission,
      parts: [{ type: 'tool-Bash', toolCallId: 'p', state: 'output-available', input: {}, output: 'done' }]
    }
    const preview = selectConversationPreview([answered, approved, reply])
    expect(preview.request).toBeUndefined()
    expect(preview.remainingRequests).toBe(0)
    expect(preview.messages.map((m) => m.id)).toEqual(['permission', 'reply'])
  })
})
