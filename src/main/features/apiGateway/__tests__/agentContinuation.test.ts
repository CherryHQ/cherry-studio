import { describe, expect, it } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { AGENT_CONTINUATION_TEXT, appendInternalAgentContinuation } from '../utils/agentContinuation'

const userMessage: CherryUIMessage = {
  id: 'user-1',
  role: 'user',
  parts: [{ type: 'text', text: 'Original request' }]
}

const assistantTextMessage: CherryUIMessage = {
  id: 'assistant-1',
  role: 'assistant',
  parts: [
    { type: 'text', text: 'Deferred tools context' },
    { type: 'text', text: 'Deferred skills context' }
  ]
}

const nonTextParts: Array<[string, CherryUIMessage['parts'][number]]> = [
  [
    'dynamic-tool part',
    {
      type: 'dynamic-tool',
      toolName: 'read_file',
      toolCallId: 'tool-1',
      state: 'input-available',
      input: { path: '/tmp/file' }
    }
  ],
  ['reasoning part', { type: 'reasoning', text: 'Reasoning' }]
]

describe('appendInternalAgentContinuation', () => {
  it('returns the same messages for an empty list', () => {
    const messages: CherryUIMessage[] = []

    expect(appendInternalAgentContinuation(messages)).toBe(messages)
  })

  it('returns the same messages when the list ends with a user message', () => {
    const messages = [userMessage]

    expect(appendInternalAgentContinuation(messages)).toBe(messages)
  })

  it('appends a user continuation after a text-only assistant message without mutating the input', () => {
    const messages = [userMessage, assistantTextMessage]
    const snapshot = structuredClone(messages)

    const result = appendInternalAgentContinuation(messages)

    expect(result).not.toBe(messages)
    expect(result).toEqual([
      userMessage,
      assistantTextMessage,
      {
        id: 'no-prefill-continuation',
        role: 'user',
        parts: [{ type: 'text', text: AGENT_CONTINUATION_TEXT }]
      }
    ])
    expect(messages).toHaveLength(2)
    expect(messages).toEqual(snapshot)
  })

  it.each(nonTextParts)(
    'returns the same messages when the trailing assistant contains a %s',
    (_label, nonTextPart) => {
      const messages: CherryUIMessage[] = [
        userMessage,
        {
          id: 'assistant-2',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Context' }, nonTextPart]
        }
      ]

      expect(appendInternalAgentContinuation(messages)).toBe(messages)
    }
  )
})
