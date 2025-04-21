import type { Model } from '@renderer/types'
import { ChatCompletionMessageParam } from 'openai/resources'
import { describe, expect, it } from 'vitest'

import { processReqMessages } from '../ModelMessageService'

describe('ModelMessageService', () => {
  const mockMessages: ChatCompletionMessageParam[] = [
    { role: 'user', content: 'First question' },
    { role: 'user', content: 'Additional context' },
    { role: 'assistant', content: 'First answer' },
    { role: 'assistant', content: 'Additional information' },
    { role: 'user', content: 'Second question' },
    { role: 'assistant', content: 'Second answer' }
  ]

  it('should insert empty messages between consecutive same-role messages for deepseek-reasoner model', () => {
    const model = { id: 'deepseek-reasoner' } as Model
    const result = processReqMessages(model, mockMessages)

    expect(result.length).toBe(8)
    expect(result[0]).toEqual({
      role: 'user',
      content: 'First question'
    })
    expect(result[1]).toEqual({
      role: 'assistant',
      content: ''
    })
    expect(result[2]).toEqual({
      role: 'user',
      content: 'Additional context'
    })
    expect(result[3]).toEqual({
      role: 'assistant',
      content: 'First answer'
    })
    expect(result[4]).toEqual({
      role: 'user',
      content: ''
    })
    expect(result[5]).toEqual({
      role: 'assistant',
      content: 'Additional information'
    })
    expect(result[6]).toEqual({
      role: 'user',
      content: 'Second question'
    })
    expect(result[7]).toEqual({
      role: 'assistant',
      content: 'Second answer'
    })
  })

  it('should not modify messages for other models', () => {
    const model = { id: 'gpt-4' } as Model
    const result = processReqMessages(model, mockMessages)

    expect(result.length).toBe(mockMessages.length)
    expect(result).toEqual(mockMessages)
  })

  it('should handle empty messages array', () => {
    const model = { id: 'deepseek-reasoner' } as Model
    const result = processReqMessages(model, [])

    expect(result.length).toBe(0)
    expect(result).toEqual([])
  })

  it('should handle single message', () => {
    const model = { id: 'deepseek-reasoner' } as Model
    const singleMessage: ChatCompletionMessageParam[] = [{ role: 'user', content: 'Single message' }]
    const result = processReqMessages(model, singleMessage)

    expect(result.length).toBe(1)
    expect(result).toEqual(singleMessage)
  })

  it('should preserve other message properties when inserting empty messages', () => {
    const model = { id: 'deepseek-reasoner' } as Model
    const messagesWithProps = [
      {
        role: 'user',
        content: 'First message',
        name: 'user1',
        function_call: { name: 'test', arguments: '{}' }
      },
      {
        role: 'user',
        content: 'Second message',
        name: 'user1'
      }
    ] as ChatCompletionMessageParam[]

    const result = processReqMessages(model, messagesWithProps)

    expect(result.length).toBe(3)
    expect(result[0]).toEqual({
      role: 'user',
      content: 'First message',
      name: 'user1',
      function_call: { name: 'test', arguments: '{}' }
    })
    expect(result[1]).toEqual({
      role: 'assistant',
      content: ''
    })
    expect(result[2]).toEqual({
      role: 'user',
      content: 'Second message',
      name: 'user1'
    })
  })

  it('should handle alternating roles correctly', () => {
    const model = { id: 'deepseek-reasoner' } as Model
    const alternatingMessages = [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' }
    ] as ChatCompletionMessageParam[]

    const result = processReqMessages(model, alternatingMessages)

    expect(result.length).toBe(4)
    expect(result).toEqual(alternatingMessages)
  })

  it('should handle messages with empty content', () => {
    const model = { id: 'deepseek-reasoner' } as Model
    const messagesWithEmpty = [
      { role: 'user', content: 'Q1' },
      { role: 'user', content: '' },
      { role: 'user', content: 'Q2' }
    ] as ChatCompletionMessageParam[]

    const result = processReqMessages(model, messagesWithEmpty)

    expect(result.length).toBe(5)
    expect(result[0]).toEqual({
      role: 'user',
      content: 'Q1'
    })
    expect(result[1]).toEqual({
      role: 'assistant',
      content: ''
    })
    expect(result[2]).toEqual({
      role: 'user',
      content: ''
    })
    expect(result[3]).toEqual({
      role: 'assistant',
      content: ''
    })
    expect(result[4]).toEqual({
      role: 'user',
      content: 'Q2'
    })
  })

  it('should handle specific case with consecutive user messages', () => {
    const model = { id: 'deepseek-reasoner' } as Model
    const messages = [
      { role: 'assistant', content: 'Initial assistant message' },
      { role: 'user', content: 'First user message' },
      { role: 'user', content: 'Second user message' }
    ] as ChatCompletionMessageParam[]

    const result = processReqMessages(model, messages)

    expect(result.length).toBe(4)
    expect(result[0]).toEqual({
      role: 'assistant',
      content: 'Initial assistant message'
    })
    expect(result[1]).toEqual({
      role: 'user',
      content: 'First user message'
    })
    expect(result[2]).toEqual({
      role: 'assistant',
      content: ''
    })
    expect(result[3]).toEqual({
      role: 'user',
      content: 'Second user message'
    })
  })

  it('should handle specific case with consecutive assistant messages', () => {
    const model = { id: 'deepseek-reasoner' } as Model
    const messages = [
      { role: 'user', content: 'Initial user message' },
      { role: 'assistant', content: 'First assistant message' },
      { role: 'assistant', content: 'Second assistant message' }
    ] as ChatCompletionMessageParam[]

    const result = processReqMessages(model, messages)

    expect(result.length).toBe(4)
    expect(result[0]).toEqual({
      role: 'user',
      content: 'Initial user message'
    })
    expect(result[1]).toEqual({
      role: 'assistant',
      content: 'First assistant message'
    })
    expect(result[2]).toEqual({
      role: 'user',
      content: ''
    })
    expect(result[3]).toEqual({
      role: 'assistant',
      content: 'Second assistant message'
    })
  })
})
