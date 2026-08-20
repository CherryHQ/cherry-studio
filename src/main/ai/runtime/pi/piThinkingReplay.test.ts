import { describe, expect, it, vi } from 'vitest'

import { normalizeCherryInThinkingReplay, withCherryInThinkingReplay } from './piThinkingReplay'

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

describe('CherryIN thinking replay', () => {
  it('adds the response id as a thinking signature to tool-only assistant messages', () => {
    const message = {
      role: 'assistant' as const,
      content: [{ type: 'toolCall' as const, id: 'call-1', name: 'read', arguments: {} }],
      api: 'anthropic-messages',
      provider: 'cherryin',
      model: 'agent/deepseek-v4-flash',
      responseId: 'msg_67d1dfdd-27df-953a-ad66-7347035d7b35',
      usage,
      stopReason: 'toolUse' as const,
      timestamp: 1
    }
    const context = { messages: [message] }

    expect(normalizeCherryInThinkingReplay(context)).toEqual({
      messages: [
        {
          ...message,
          content: [
            { type: 'thinking', thinking: '\u200B', thinkingSignature: '67d1dfdd-27df-953a-ad66-7347035d7b35' },
            ...message.content
          ]
        }
      ]
    })
    expect(context.messages[0]).toBe(message)
  })

  it('leaves messages with existing thinking and non-tool messages unchanged', () => {
    const context = {
      messages: [
        { role: 'user' as const, content: 'hello', timestamp: 1 },
        {
          role: 'assistant' as const,
          content: [
            { type: 'thinking' as const, thinking: 'reason', thinkingSignature: 'sig' },
            { type: 'toolCall' as const, id: 'call-1', name: 'read', arguments: {} }
          ],
          api: 'anthropic-messages',
          provider: 'cherryin',
          model: 'agent/deepseek-v4-flash',
          usage,
          stopReason: 'toolUse' as const,
          timestamp: 2
        }
      ]
    }

    expect(normalizeCherryInThinkingReplay(context)).toBe(context)
  })

  it('normalizes context before delegating to the Anthropic stream', () => {
    const stream = {} as ReturnType<NonNullable<Parameters<typeof withCherryInThinkingReplay>[1]>>
    const delegate = vi.fn(() => stream)
    const config = withCherryInThinkingReplay(
      { name: 'CherryIN', baseUrl: '', api: 'anthropic-messages', models: [] },
      delegate
    )
    const context = {
      messages: [
        {
          role: 'assistant' as const,
          content: [{ type: 'toolCall' as const, id: 'call-1', name: 'read', arguments: {} }],
          api: 'anthropic-messages',
          provider: 'cherryin',
          model: 'agent/deepseek-v4-flash',
          responseId: 'msg_67d1dfdd-27df-953a-ad66-7347035d7b35',
          usage,
          stopReason: 'toolUse' as const,
          timestamp: 1
        }
      ]
    }

    expect(config.streamSimple!({} as never, context, {})).toBe(stream)
    const delegatedContext = (delegate.mock.calls as unknown as [unknown, typeof context][])[0]?.[1]
    expect(delegatedContext?.messages[0].content[0]).toEqual({
      type: 'thinking',
      thinking: '\u200B',
      thinkingSignature: '67d1dfdd-27df-953a-ad66-7347035d7b35'
    })
  })
})
