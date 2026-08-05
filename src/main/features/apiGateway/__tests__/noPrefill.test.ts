import type { CherryUIMessage } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  appendNoPrefillContinuation,
  isNoAssistantPrefillClaudeModel,
  NO_PREFILL_CONTINUATION_TEXT
} from '../utils/noPrefill'

function createModel(apiModelId: string): Model {
  return {
    id: `test::${apiModelId}`,
    providerId: 'test',
    apiModelId,
    name: apiModelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
}

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

describe('isNoAssistantPrefillClaudeModel', () => {
  it.each([
    'claude-opus-4-6',
    'claude-opus-4.7',
    'claude-opus-4-8',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-opus-5-20260101',
    'anthropic.claude-opus-4-6',
    'CLAUDE-OPUS-5',
    'claude-mythos-preview',
    'anthropic.claude-mythos-preview'
  ])('matches no-prefill Claude model %s', (apiModelId) => {
    expect(isNoAssistantPrefillClaudeModel(createModel(apiModelId))).toBe(true)
  })

  it.each([
    'claude-opus-4-5',
    'claude-sonnet-4.5',
    'claude-haiku-4-5',
    'claude-3-5-sonnet',
    'claude-opus-4',
    'gpt-5.5'
  ])('rejects model %s that still supports prefill or is not Claude', (apiModelId) => {
    expect(isNoAssistantPrefillClaudeModel(createModel(apiModelId))).toBe(false)
  })
})

describe('appendNoPrefillContinuation', () => {
  it('returns the same messages for an empty list', () => {
    const messages: CherryUIMessage[] = []

    expect(appendNoPrefillContinuation(messages)).toBe(messages)
  })

  it('returns the same messages when the list ends with a user message', () => {
    const messages = [userMessage]

    expect(appendNoPrefillContinuation(messages)).toBe(messages)
  })

  it('appends a user continuation after a text-only assistant message without mutating the input', () => {
    const messages = [userMessage, assistantTextMessage]
    const snapshot = structuredClone(messages)

    const result = appendNoPrefillContinuation(messages)

    expect(result).not.toBe(messages)
    expect(result).toEqual([
      userMessage,
      assistantTextMessage,
      {
        id: 'no-prefill-continuation',
        role: 'user',
        parts: [{ type: 'text', text: NO_PREFILL_CONTINUATION_TEXT }]
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

      expect(appendNoPrefillContinuation(messages)).toBe(messages)
    }
  )
})
