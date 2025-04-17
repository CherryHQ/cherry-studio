import assert from 'node:assert'
import { test } from 'node:test'

import { ChatCompletionMessageParam } from 'openai/resources'

const { processReqMessages } = require('../ModelMessageService')

test('ModelMessageService', async (t) => {
  const mockMessages: ChatCompletionMessageParam[] = [
    { role: 'user', content: 'First question' },
    { role: 'user', content: 'Additional context' },
    { role: 'assistant', content: 'First answer' },
    { role: 'assistant', content: 'Additional information' },
    { role: 'user', content: 'Second question' },
    { role: 'assistant', content: 'Second answer' }
  ]

  await t.test('should merge successive messages with same role for deepseek-reasoner model', () => {
    const model = { id: 'deepseek-reasoner' }
    const result = processReqMessages(model, mockMessages)

    assert.strictEqual(result.length, 4)
    assert.deepStrictEqual(result[0], {
      role: 'user',
      content: 'First question\nAdditional context'
    })
    assert.deepStrictEqual(result[1], {
      role: 'assistant',
      content: 'First answer\nAdditional information'
    })
    assert.deepStrictEqual(result[2], {
      role: 'user',
      content: 'Second question'
    })
    assert.deepStrictEqual(result[3], {
      role: 'assistant',
      content: 'Second answer'
    })
  })

  await t.test('should not merge messages for other models', () => {
    const model = { id: 'gpt-4' }
    const result = processReqMessages(model, mockMessages)

    assert.strictEqual(result.length, mockMessages.length)
    assert.deepStrictEqual(result, mockMessages)
  })

  await t.test('should handle empty messages array', () => {
    const model = { id: 'deepseek-reasoner' }
    const result = processReqMessages(model, [])

    assert.strictEqual(result.length, 0)
    assert.deepStrictEqual(result, [])
  })

  await t.test('should handle single message', () => {
    const model = { id: 'deepseek-reasoner' }
    const singleMessage = [{ role: 'user', content: 'Single message' }]
    const result = processReqMessages(model, singleMessage)

    assert.strictEqual(result.length, 1)
    assert.deepStrictEqual(result, singleMessage)
  })

  await t.test('should preserve other message properties when merging', () => {
    const model = { id: 'deepseek-reasoner' }
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

    assert.strictEqual(result.length, 1)
    assert.deepStrictEqual(result[0], {
      role: 'user',
      content: 'First message\nSecond message',
      name: 'user1',
      function_call: { name: 'test', arguments: '{}' }
    })
  })

  await t.test('should handle alternating roles correctly', () => {
    const model = { id: 'deepseek-reasoner' }
    const alternatingMessages = [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' }
    ] as ChatCompletionMessageParam[]

    const result = processReqMessages(model, alternatingMessages)

    assert.strictEqual(result.length, 4)
    assert.deepStrictEqual(result, alternatingMessages)
  })

  await t.test('should handle messages with empty content', () => {
    const model = { id: 'deepseek-reasoner' }
    const messagesWithEmpty = [
      { role: 'user', content: 'Q1' },
      { role: 'user', content: '' },
      { role: 'user', content: 'Q2' }
    ] as ChatCompletionMessageParam[]

    const result = processReqMessages(model, messagesWithEmpty)

    assert.strictEqual(result.length, 1)
    assert.deepStrictEqual(result[0], {
      role: 'user',
      content: 'Q1\n\nQ2'
    })
  })
})
