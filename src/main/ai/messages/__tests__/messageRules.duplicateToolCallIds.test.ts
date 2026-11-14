import type * as AISdk from 'ai'
import { convertToModelMessages, type ModelMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { assertNoDuplicateToolCallIds, DuplicateToolCallIdError, toModelMessages } from '../messageRules'

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof AISdk>()
  return { ...actual, convertToModelMessages: vi.fn(actual.convertToModelMessages) }
})

const toolCallId = 'call_00_duplicate_full_id'
const call = { type: 'tool-call', toolCallId, toolName: 'lookup', input: { query: 'first' } } as const
const result = {
  type: 'tool-result',
  toolCallId,
  toolName: 'lookup',
  output: { type: 'json', value: { answer: 'first' } }
} as const
const text = { type: 'text', text: 'between' } as const

describe('assertNoDuplicateToolCallIds', () => {
  it.each([true, false])('accepts one call and its matching result (embedded=%s)', (embedded) => {
    const messages: ModelMessage[] = embedded
      ? [{ role: 'assistant', content: [call, result] }]
      : [
          { role: 'assistant', content: [call] },
          { role: 'tool', content: [result] }
        ]
    expect(() => assertNoDuplicateToolCallIds(messages)).not.toThrow()
  })

  it('reports the first duplicate call with the full id and both content positions', () => {
    const messages: ModelMessage[] = [{ role: 'assistant', content: [text, call, text, call, call] }]
    const validate = () => assertNoDuplicateToolCallIds(messages)
    expect(validate).toThrow(DuplicateToolCallIdError)
    expect(validate).toThrow(toolCallId)
    expect(validate).toThrow('messages[0].content[1], messages[0].content[3]')
    try {
      validate()
    } catch (error) {
      expect(error).toMatchObject({
        name: 'DuplicateToolCallIdError',
        i18nKey: 'duplicate_tool_call_id',
        detailI18nKey: 'duplicate_tool_call_id_detail',
        detailI18nValues: {
          toolCallId,
          locations: 'messages[0].content[1], messages[0].content[3]'
        }
      })
      expect(error).not.toHaveProperty('providerId')
    }
  })

  it('finds duplicate calls across messages', () => {
    expect(() =>
      assertNoDuplicateToolCallIds([
        { role: 'assistant', content: [call] },
        { role: 'user', content: 'continue' },
        { role: 'assistant', content: [text, call] }
      ])
    ).toThrow(`messages[0].content[0], messages[2].content[1]`)
  })

  it('counts embedded and tool-role results together', () => {
    const validate = () =>
      assertNoDuplicateToolCallIds([
        { role: 'assistant', content: [call, result] },
        { role: 'tool', content: [result] }
      ])
    expect(validate).toThrow(DuplicateToolCallIdError)
    expect(validate).toThrow(toolCallId)
    expect(validate).toThrow('messages[0].content[1], messages[1].content[0]')
  })

  it('leaves missing and orphan results to other validation', () => {
    expect(() => assertNoDuplicateToolCallIds([{ role: 'assistant', content: [call] }])).not.toThrow()
    expect(() => assertNoDuplicateToolCallIds([{ role: 'tool', content: [result] }])).not.toThrow()
  })

  it('ignores empty history, string content, and unrelated parts', () => {
    expect(() => assertNoDuplicateToolCallIds([])).not.toThrow()
    expect(() =>
      assertNoDuplicateToolCallIds([
        { role: 'system', content: toolCallId },
        { role: 'user', content: toolCallId },
        { role: 'assistant', content: toolCallId },
        { role: 'assistant', content: [text, text] }
      ])
    ).not.toThrow()
  })

  it('toModelMessages validates after final same-role coalescing', async () => {
    vi.mocked(convertToModelMessages).mockResolvedValueOnce([
      { role: 'assistant', content: [text, call] },
      { role: 'assistant', content: [text, call] }
    ])
    const conversion = toModelMessages([
      { id: 'assistant', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] }
    ])
    await expect(conversion).rejects.toBeInstanceOf(DuplicateToolCallIdError)
    await expect(conversion).rejects.toThrow('messages[0].content[1], messages[0].content[3]')
  })
})
