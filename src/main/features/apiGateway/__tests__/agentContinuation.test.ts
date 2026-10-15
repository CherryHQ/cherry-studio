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

const reasoningPart: CherryUIMessage['parts'][number] = {
  type: 'reasoning',
  text: 'Reasoning',
  providerMetadata: { anthropic: { signature: 'signature' } }
}

const continuationParts: Array<[string, CherryUIMessage['parts']]> = [
  ['text-only', assistantTextMessage.parts],
  ['reasoning and text', [reasoningPart, ...assistantTextMessage.parts]],
  [
    'redacted reasoning and text',
    [
      { type: 'reasoning', text: '', providerMetadata: { anthropic: { redactedData: 'redacted' } } },
      ...assistantTextMessage.parts
    ]
  ],
  ['reasoning-only', [reasoningPart]]
]

const otherParts: Array<[string, CherryUIMessage['parts'][number]]> = [
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
  [
    'completed dynamic-tool part',
    {
      type: 'dynamic-tool',
      toolName: 'read_file',
      toolCallId: 'tool-1',
      state: 'output-available',
      input: { path: '/tmp/file' },
      output: 'File contents'
    }
  ],
  ['file part', { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }]
]

describe('appendInternalAgentContinuation', () => {
  it('returns the same messages for an empty list', () => {
    const messages: CherryUIMessage[] = []

    expect(appendInternalAgentContinuation(messages)).toBe(messages)
  })

  it.each(['user', 'system'] as const)('returns the same messages when the list ends with a %s message', (role) => {
    const messages = [{ ...userMessage, role }]

    expect(appendInternalAgentContinuation(messages)).toBe(messages)
  })

  it.each(continuationParts)(
    'appends once after a %s assistant message without mutating the input',
    (_label, parts) => {
      const assistantMessage = { ...assistantTextMessage, parts }
      const messages = [userMessage, assistantMessage]
      const snapshot = structuredClone(messages)

      const result = appendInternalAgentContinuation(messages)

      expect(result).not.toBe(messages)
      expect(result).toEqual([
        userMessage,
        assistantMessage,
        {
          id: 'no-prefill-continuation',
          role: 'user',
          parts: [{ type: 'text', text: AGENT_CONTINUATION_TEXT }]
        }
      ])
      expect(messages).toHaveLength(2)
      expect(messages).toEqual(snapshot)
      expect(appendInternalAgentContinuation(result)).toBe(result)
    }
  )

  it.each(otherParts)('returns the same messages when the trailing assistant contains a %s', (_label, otherPart) => {
    const messages: CherryUIMessage[] = [
      userMessage,
      {
        id: 'assistant-2',
        role: 'assistant',
        parts: [reasoningPart, { type: 'text', text: 'Context' }, otherPart]
      }
    ]

    expect(appendInternalAgentContinuation(messages)).toBe(messages)
  })
})
