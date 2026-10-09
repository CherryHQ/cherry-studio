import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import type { AssistantModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import type { TranscriptEntry, TranscriptMessageEntry } from '../src'
import { createTestSession, finish, hostStore, MODEL, plain, scriptedModel, streamTextPort, textParts } from './support'

let lastId = 0
const nextId = () => `e${++lastId}`

const user = (content: string): TranscriptEntry => ({
  kind: 'message',
  id: nextId(),
  timestamp: 1,
  message: { role: 'user', content }
})

const assistant = (
  content: AssistantModelMessage['content'],
  sidecar: Partial<TranscriptMessageEntry> = {}
): TranscriptEntry => ({
  kind: 'message',
  id: nextId(),
  timestamp: 1,
  message: { role: 'assistant', content },
  modelKey: MODEL.key,
  stopReason: 'stop',
  ...sidecar
})

const assistantsOf = (prompt: LanguageModelV3Prompt) =>
  prompt.flatMap((m) => (m.role === 'assistant' ? [plain(m.content)] : []))

describe('transcript replayed into a fresh session', () => {
  it('replays signed reasoning to the same model key even when the Pi provider id changed', async () => {
    const first = scriptedModel([
      [
        { type: 'reasoning-start', id: 'r' },
        { type: 'reasoning-delta', id: 'r', delta: 'remember the name' },
        { type: 'reasoning-end', id: 'r', providerMetadata: { anthropic: { signature: 'sig-1' } } },
        ...textParts('t', 'Hi Li.'),
        finish('stop')
      ]
    ])
    const host = hostStore()
    const earlier = await createTestSession({ port: streamTextPort(first.model).port, onEvent: host.onEvent })
    await earlier.session.prompt('My name is Li.')
    await earlier.dispose()

    const second = scriptedModel([[...textParts('t', 'You are Li.'), finish('stop')]])
    const { session } = await createTestSession({
      port: streamTextPort(second.model).port,
      model: { ...MODEL, provider: 'cherry-reconnected' },
      transcript: host.entries
    })
    await session.prompt("What's my name?")

    expect(assistantsOf(second.calls[0].prompt)).toEqual([
      [
        { type: 'reasoning', text: 'remember the name', providerOptions: { anthropic: { signature: 'sig-1' } } },
        { type: 'text', text: 'Hi Li.' }
      ]
    ])
  })

  it('does not replay another model’s reasoning or signatures as reasoning', async () => {
    const transcript = [
      user('My name is Li.'),
      assistant([
        { type: 'reasoning', text: 'remember', providerOptions: { anthropic: { signature: 'sig-old' } } },
        { type: 'text', text: 'Nice to meet you, Li.' }
      ]),
      user('I live in Paris.'),
      assistant(
        [
          { type: 'reasoning', text: 'other model reasoning', providerOptions: { openai: { itemId: 'x' } } },
          { type: 'text', text: 'Paris is lovely.', providerOptions: { openai: { itemId: 'y' } } }
        ],
        { modelKey: 'openai::other-model' }
      )
    ]
    const { model, calls } = scriptedModel([[...textParts('t', 'You are Li, in Paris.'), finish('stop')]])
    const { session } = await createTestSession({ port: streamTextPort(model).port, transcript })
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
    const transcript = [
      user('Check the weather.'),
      assistant([{ type: 'tool-call', toolCallId: 'call_lost', toolName: 'get_weather', input: { city: 'Oslo' } }], {
        stopReason: 'toolUse'
      }),
      user('Never mind.'),
      assistant([{ type: 'text', text: 'half an ans' }], { stopReason: 'aborted', errorMessage: 'aborted' })
    ]
    const { model, calls } = scriptedModel([[...textParts('t', 'OK.'), finish('stop')]])
    const { session } = await createTestSession({ port: streamTextPort(model).port, transcript })
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
