import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import { AI_SDK_API, encodeProviderMetadata } from '../src'
import { createTestSession, finish, MODEL, plain, scriptedModel, streamTextPort, textParts } from './support'

const zeroUsage: AssistantMessage['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

function assistant(content: AssistantMessage['content'], from: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: AI_SDK_API,
    provider: MODEL.provider,
    model: MODEL.id,
    usage: zeroUsage,
    stopReason: 'stop',
    timestamp: 1,
    ...from
  }
}

const user = (content: string): Message => ({ role: 'user', content, timestamp: 1 })
const assistantsOf = (prompt: LanguageModelV3Prompt) =>
  prompt.flatMap((m) => (m.role === 'assistant' ? [plain(m.content)] : []))

describe('history seeded into a fresh session', () => {
  it('replays signed reasoning recorded by an earlier session of the same model', async () => {
    const first = scriptedModel([
      [
        { type: 'reasoning-start', id: 'r' },
        { type: 'reasoning-delta', id: 'r', delta: 'remember the name' },
        { type: 'reasoning-end', id: 'r', providerMetadata: { anthropic: { signature: 'sig-1' } } },
        ...textParts('t', 'Hi Li.'),
        finish('stop')
      ]
    ])
    const earlier = await createTestSession({ port: streamTextPort(first.model).port })
    await earlier.session.prompt('My name is Li.')
    const history = earlier.session.messages as Message[]
    await earlier.dispose()

    const second = scriptedModel([[...textParts('t', 'You are Li.'), finish('stop')]])
    const { session } = await createTestSession({ port: streamTextPort(second.model).port, history })
    await session.prompt("What's my name?")

    expect(assistantsOf(second.calls[0].prompt)).toEqual([
      [
        { type: 'reasoning', text: 'remember the name', providerOptions: { anthropic: { signature: 'sig-1' } } },
        { type: 'text', text: 'Hi Li.' }
      ]
    ])
  })

  it('does not replay another model’s reasoning or signatures as reasoning', async () => {
    const history: Message[] = [
      user('My name is Li.'),
      assistant([
        {
          type: 'thinking',
          thinking: 'remember',
          thinkingSignature: encodeProviderMetadata({ anthropic: { signature: 'sig-old' } })
        },
        { type: 'text', text: 'Nice to meet you, Li.' }
      ]),
      user('I live in Paris.'),
      assistant(
        [
          {
            type: 'thinking',
            thinking: 'other model reasoning',
            thinkingSignature: encodeProviderMetadata({ openai: { itemId: 'x' } })
          },
          { type: 'text', text: 'Paris is lovely.', textSignature: encodeProviderMetadata({ openai: { itemId: 'y' } }) }
        ],
        { provider: 'other-provider', model: 'other-model', api: 'openai-completions' }
      )
    ]
    const { model, calls } = scriptedModel([[...textParts('t', 'You are Li, in Paris.'), finish('stop')]])
    const { session } = await createTestSession({ port: streamTextPort(model).port, history })
    await session.prompt("What's my name and city?")

    expect(assistantsOf(calls[0].prompt)).toEqual([
      [
        { type: 'reasoning', text: 'remember', providerOptions: { anthropic: { signature: 'sig-old' } } },
        { type: 'text', text: 'Nice to meet you, Li.' }
      ],
      [
        { type: 'text', text: 'other model reasoning' },
        { type: 'text', text: 'Paris is lovely.' }
      ]
    ])
  })

  it('answers tool calls left without a result and skips failed turns', async () => {
    const history: Message[] = [
      user('Check the weather.'),
      assistant([{ type: 'toolCall', id: 'call_lost', name: 'get_weather', arguments: { city: 'Oslo' } }], {
        stopReason: 'toolUse'
      }),
      user('Never mind.'),
      assistant([{ type: 'text', text: 'half an ans' }], { stopReason: 'aborted', errorMessage: 'aborted' })
    ]
    const { model, calls } = scriptedModel([[...textParts('t', 'OK.'), finish('stop')]])
    const { session } = await createTestSession({ port: streamTextPort(model).port, history })
    await session.prompt('Hello again')

    const prompt = calls[0].prompt
    expect(prompt.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user', 'user'])
    expect(plain(prompt[3].content)).toEqual([
      expect.objectContaining({
        type: 'tool-result',
        toolCallId: 'call_lost',
        output: expect.objectContaining({ type: 'error-text' })
      })
    ])
    expect(JSON.stringify(prompt)).not.toContain('half an ans')
  })
})
