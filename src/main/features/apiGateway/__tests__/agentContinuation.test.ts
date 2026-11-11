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

    expect(appendInternalAgentContinuation(messages)).toEqual(messages)
  })

  it('returns the same messages when the list ends with a user message', () => {
    const messages = [userMessage]

    expect(appendInternalAgentContinuation(messages)).toEqual(messages)
  })

  it('appends a user continuation after a text-only assistant message without mutating the input', () => {
    const messages = [userMessage, assistantTextMessage]
    const snapshot = structuredClone(messages)

    const result = appendInternalAgentContinuation(messages)

    expect(result).toEqual([
      userMessage,
      assistantTextMessage,
      expect.objectContaining({
        role: 'user',
        parts: [{ type: 'text', text: AGENT_CONTINUATION_TEXT }]
      })
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

      expect(appendInternalAgentContinuation(messages)).toEqual(messages)
    }
  )

  it.each(
    (
      [
        { state: 'output-error', errorText: 'Tool failed' },
        { state: 'output-denied', approval: { id: 'approval-1', approved: false } },
        { state: 'output-available', output: 'Done' },
        { state: 'output-available', output: 'Done', preliminary: false }
      ] as const
    ).flatMap((settlement) =>
      (['dynamic-tool', 'tool-Bash'] as const).flatMap((toolType) =>
        (['text', 'reasoning'] as const).map((type) => ({ settlement, toolType, type }))
      )
    )
  )(
    'appends once after $toolType ($settlement) followed by $type and preserves parts',
    ({ settlement, toolType, type }) => {
      const messages: CherryUIMessage[] = [
        userMessage,
        {
          id: 'assistant-2',
          role: 'assistant',
          parts: [
            {
              type: toolType,
              toolName: 'Bash',
              toolCallId: 'call_1',
              input: {},
              providerExecuted: false,
              ...settlement
            },
            { type, text: 'Working' }
          ]
        }
      ]
      const snapshot = structuredClone(messages)

      const result = appendInternalAgentContinuation(messages)

      expect(result).not.toBe(messages)
      expect(result).toEqual([
        ...snapshot,
        {
          id: 'no-prefill-continuation',
          role: 'user',
          parts: [{ type: 'text', text: AGENT_CONTINUATION_TEXT }]
        }
      ])
      expect(result[1]).toBe(messages[1])
      expect(result[1].parts).toBe(messages[1].parts)
      expect(messages).toEqual(snapshot)
      expect(appendInternalAgentContinuation(result)).toBe(result)
    }
  )

  it.each([
    {
      label: 'preliminary tool output before text',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'Bash',
          toolCallId: 'call_1',
          input: {},
          state: 'output-available',
          output: 'Partial',
          preliminary: true
        },
        { type: 'text', text: 'Working' }
      ]
    },
    {
      label: 'provider-executed settled tool before text',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'Bash',
          toolCallId: 'call_1',
          input: {},
          state: 'output-available',
          output: 'Done',
          providerExecuted: true
        },
        { type: 'text', text: 'Working' }
      ]
    },
    {
      label: 'text before a final settled tool',
      parts: [
        { type: 'text', text: 'Working' },
        {
          type: 'dynamic-tool',
          toolName: 'Bash',
          toolCallId: 'call_1',
          input: {},
          state: 'output-available',
          output: 'Done'
        }
      ]
    },
    {
      label: 'settled tool before data-error',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'Bash',
          toolCallId: 'call_1',
          input: {},
          state: 'output-error',
          errorText: 'Tool failed'
        },
        { type: 'data-error', data: { message: 'Failed' } }
      ]
    },
    {
      label: 'settled tool and data-error before text',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'Bash',
          toolCallId: 'call_1',
          input: {},
          state: 'output-error',
          errorText: 'Tool failed'
        },
        { type: 'data-error', data: { message: 'Failed' } },
        { type: 'text', text: 'Working' }
      ]
    }
  ] satisfies Array<{ label: string; parts: CherryUIMessage['parts'] }>)('leaves $label unchanged', ({ parts }) => {
    const messages: CherryUIMessage[] = [userMessage, { id: 'assistant-2', role: 'assistant', parts }]
    const snapshot = structuredClone(messages)

    expect(appendInternalAgentContinuation(messages)).toBe(messages)
    expect(messages).toEqual(snapshot)
  })

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
