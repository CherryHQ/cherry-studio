import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import type { MessageListItem } from '../../types'
import {
  getLatestAssistantGroupKey,
  getMessageGroupKey,
  groupMessageListItems,
  withHistoricalProcessGroups
} from '../messageGroupKey'

const createMessage = (id: string, role: MessageListItem['role'], parentId?: string | null) =>
  ({
    id,
    role,
    parentId
  }) as MessageListItem

describe('messageGroupKey', () => {
  const tool = (id: string): CherryMessagePart => ({
    type: 'dynamic-tool',
    toolName: 'historical_tool',
    toolCallId: id,
    state: 'output-available',
    input: {},
    output: id
  })
  const historical = (id: string): MessageListItem => ({ ...createMessage(id, 'assistant'), status: 'success' })
  it('groups adjacent historical process records without consuming an answer or user message', () => {
    const messages = [
      historical('call'),
      historical('result'),
      historical('answer'),
      createMessage('user', 'user'),
      historical('later')
    ]
    const parts = {
      call: [tool('call')],
      result: [{ type: 'reasoning' as const, text: 'thought' }, tool('result')],
      answer: [{ type: 'text' as const, text: 'Final answer' }],
      later: [tool('later')]
    }
    const projected = withHistoricalProcessGroups(messages, parts, new WeakMap())
    expect(Object.values(groupMessageListItems(projected)).map((group) => group.map((message) => message.id))).toEqual([
      ['call', 'result'],
      ['answer'],
      ['user'],
      ['later']
    ])
    expect(messages.every((message) => !message.historicalProcessGroupId)).toBe(true)
    expect(projected[2]).toBe(messages[2])
  })
  it('groups imported reasoning and terminal tool records but stops at assistant text', () => {
    const messages = [
      { ...historical('reasoning'), isImportedHistory: true, parentId: 'root' },
      { ...historical('call'), isImportedHistory: true, parentId: 'reasoning' },
      { ...historical('error'), isImportedHistory: true, status: 'error' as const },
      { ...historical('paused'), isImportedHistory: true, status: 'paused' as const },
      { ...historical('text'), isImportedHistory: true },
      { ...historical('later-reasoning'), isImportedHistory: true },
      { ...historical('later-tool'), isImportedHistory: true }
    ]
    const failed: CherryMessagePart = {
      type: 'dynamic-tool',
      toolName: 'historical_tool',
      toolCallId: 'failed',
      state: 'output-error',
      input: {},
      errorText: 'Interrupted'
    }
    const parts = {
      reasoning: [{ type: 'reasoning' as const, text: 'source thought' }],
      call: [tool('call')],
      error: [failed],
      paused: [failed],
      text: [{ type: 'text' as const, text: 'Assistant explanation' }],
      'later-reasoning': [{ type: 'reasoning' as const, text: 'next thought' }],
      'later-tool': [tool('later')]
    }
    const projected = withHistoricalProcessGroups(messages, parts, new WeakMap())
    expect(Object.values(groupMessageListItems(projected)).map((group) => group.map((message) => message.id))).toEqual([
      ['reasoning', 'call', 'error', 'paused'],
      ['text'],
      ['later-reasoning', 'later-tool']
    ])
    expect(projected[2].status).toBe('error')
    expect(projected[3].status).toBe('paused')
  })
  it('keeps the group anchor and existing members stable when older history is prepended', () => {
    const messages = [historical('call'), historical('result')]
    const parts = { older: [tool('older')], call: [tool('call')], result: [tool('result')] }
    const cache = new WeakMap<MessageListItem, MessageListItem>()
    const first = withHistoricalProcessGroups(messages, parts, cache)
    const next = withHistoricalProcessGroups([historical('older'), ...messages], parts, cache)
    expect(getMessageGroupKey(next[0])).toBe(getMessageGroupKey(first[0]))
    expect(next[1]).toBe(first[0])
    expect(next[2]).toBe(first[1])
  })
  it('does not merge live tools, paused history or parallel model replies', () => {
    const messages = [
      { ...historical('live'), status: 'pending' as const },
      { ...historical('paused'), status: 'paused' as const },
      { ...historical('parallel'), parentId: 'user' }
    ]
    const projected = withHistoricalProcessGroups(
      messages,
      Object.fromEntries(messages.map((message) => [message.id, [tool(message.id)]])),
      new WeakMap()
    )
    expect(projected).toEqual(messages)
  })
  it('uses the parent id for assistant sibling groups', () => {
    expect(getMessageGroupKey(createMessage('assistant-1', 'assistant', 'user-1'))).toBe('assistantuser-1')
  })

  it('uses role and id for non-assistant messages', () => {
    expect(getMessageGroupKey(createMessage('user-1', 'user'))).toBe('useruser-1')
  })

  it('groups assistant siblings together and keeps user messages separate', () => {
    const grouped = groupMessageListItems([
      createMessage('user-1', 'user'),
      createMessage('assistant-1', 'assistant', 'user-1'),
      createMessage('assistant-2', 'assistant', 'user-1')
    ])

    expect(Object.keys(grouped)).toEqual(['useruser-1', 'assistantuser-1'])
    expect(grouped['assistantuser-1'].map((message) => message.id)).toEqual(['assistant-1', 'assistant-2'])
  })

  it('returns the latest assistant group key', () => {
    const messages = [
      createMessage('assistant-1', 'assistant', 'user-1'),
      createMessage('user-2', 'user'),
      createMessage('assistant-2', 'assistant', 'user-2')
    ]

    expect(getLatestAssistantGroupKey(messages)).toBe('assistantuser-2')
  })
})
