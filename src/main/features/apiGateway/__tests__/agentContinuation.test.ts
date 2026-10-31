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

  it.each(['text', 'reasoning'] as const)(
    'returns the same messages when the trailing assistant contains %s and a dynamic-tool part',
    (type) => {
      const messages: CherryUIMessage[] = [
        userMessage,
        {
          id: 'assistant-2',
          role: 'assistant',
          parts: [
            { type, text: 'Context' },
            {
              type: 'dynamic-tool',
              toolName: 'read_file',
              toolCallId: 'tool-1',
              state: 'input-available',
              input: { path: '/tmp/file' }
            }
          ]
        }
      ]

      expect(appendInternalAgentContinuation(messages)).toBe(messages)
    }
  )

  it.each([
    {
      label: 'reasoning only',
      parts: [{ type: 'reasoning', text: 'Thinking', providerMetadata: { anthropic: { signature: 'signed' } } }],
      expectedParts: [{ type: 'reasoning', text: 'Thinking', providerMetadata: { anthropic: { signature: 'signed' } } }]
    },
    {
      label: 'reasoning then text',
      parts: [
        { type: 'reasoning', text: 'Thinking', providerMetadata: { anthropic: { signature: '' } } },
        { type: 'text', text: 'Working' }
      ],
      expectedParts: [
        { type: 'reasoning', text: 'Thinking', providerMetadata: { anthropic: { signature: '' } } },
        { type: 'text', text: 'Working' }
      ]
    },
    {
      label: 'text then reasoning',
      parts: [
        { type: 'text', text: 'Working' },
        { type: 'reasoning', text: 'Thinking' }
      ],
      expectedParts: [
        { type: 'text', text: 'Working' },
        { type: 'reasoning', text: 'Thinking' }
      ]
    },
    { label: 'empty parts', parts: [], expectedParts: [] }
  ] satisfies Array<{ label: string; parts: CherryUIMessage['parts']; expectedParts: CherryUIMessage['parts'] }>)(
    'appends once after $label and preserves the original parts',
    ({ parts, expectedParts }) => {
      const messages: CherryUIMessage[] = [userMessage, { id: 'assistant-2', role: 'assistant', parts }]
      const snapshot = structuredClone(messages)

      const result = appendInternalAgentContinuation(messages)

      expect(result).not.toBe(messages)
      expect(result).toEqual([
        { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Original request' }] },
        { id: 'assistant-2', role: 'assistant', parts: expectedParts },
        {
          id: 'no-prefill-continuation',
          role: 'user',
          parts: [{ type: 'text', text: AGENT_CONTINUATION_TEXT }]
        }
      ])
      expect(result[1]).toBe(messages[1])
      expect(messages).toEqual(snapshot)
      expect(appendInternalAgentContinuation(result)).toBe(result)
    }
  )
})
