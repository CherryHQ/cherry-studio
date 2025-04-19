import { Model } from '@renderer/types'
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

  const createModel = (id: string): Model => ({
    id,
    provider: 'test-provider',
    name: id,
    group: 'test-group'
  })

  it('should merge successive messages with same role for deepseek-reasoner model', () => {
    const model = createModel('deepseek-reasoner')
    const result = processReqMessages(model, mockMessages)

    expect(result.length).toBe(4)
    expect(result[0]).toEqual({
      role: 'user',
      content: 'First question\nAdditional context'
    })
    expect(result[1]).toEqual({
      role: 'assistant',
      content: 'First answer\nAdditional information'
    })
    expect(result[2]).toEqual({
      role: 'user',
      content: 'Second question'
    })
    expect(result[3]).toEqual({
      role: 'assistant',
      content: 'Second answer'
    })
  })

  it('should not merge messages for other models', () => {
    const model = createModel('gpt-4')
    const result = processReqMessages(model, mockMessages)

    expect(result.length).toBe(mockMessages.length)
    expect(result).toEqual(mockMessages)
  })

  it('should handle empty messages array', () => {
    const model = createModel('deepseek-reasoner')
    const result = processReqMessages(model, [])

    expect(result.length).toBe(0)
    expect(result).toEqual([])
  })

  it('should handle single message', () => {
    const model = createModel('deepseek-reasoner')
    const singleMessage = [{ role: 'user', content: 'Single message' }]
    const result = processReqMessages(model, singleMessage as ChatCompletionMessageParam[])

    expect(result.length).toBe(1)
    expect(result).toEqual(singleMessage)
  })

  it('should preserve other message properties when merging', () => {
    const model = createModel('deepseek-reasoner')
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

    expect(result.length).toBe(1)
    expect(result[0]).toEqual({
      role: 'user',
      content: 'First message\nSecond message',
      name: 'user1',
      function_call: { name: 'test', arguments: '{}' }
    })
  })

  it('should handle alternating roles correctly', () => {
    const model = createModel('deepseek-reasoner')
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
    const model = createModel('deepseek-reasoner')
    const messagesWithEmpty = [
      { role: 'user', content: 'Q1' },
      { role: 'user', content: '' },
      { role: 'user', content: 'Q2' }
    ] as ChatCompletionMessageParam[]

    const result = processReqMessages(model, messagesWithEmpty)

    expect(result.length).toBe(1)
    expect(result[0]).toEqual({
      role: 'user',
      content: 'Q1\n\nQ2'
    })
  })
})
