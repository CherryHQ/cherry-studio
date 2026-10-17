import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LlmGenerateEvent, LlmGenerateInput, LlmGenerateResult } from '@main/ai/localModel'

const generate =
  vi.fn<
    (
      modelId: string,
      input: LlmGenerateInput,
      options: { signal?: AbortSignal; onEvent: (event: LlmGenerateEvent) => void }
    ) => Promise<LlmGenerateResult>
  >()

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'LlmInferenceService') return { generate }
      throw new Error(`Unexpected application.get(${name})`)
    }
  }
}))

import { createLocalLlmProvider } from '../localLlm/localLlmProvider'

const RESULT: LlmGenerateResult = { finishReason: 'stop', usage: { inputTokens: 12, outputTokens: 3 } }

function callOptions(overrides: Partial<LanguageModelV3CallOptions> = {}): LanguageModelV3CallOptions {
  return { prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], ...overrides }
}

async function readStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamPart[]> {
  const { stream } = await createLocalLlmProvider().languageModel('qwen3.5-4b-q4_k_m').doStream(options)
  const parts: LanguageModelV3StreamPart[] = []
  for await (const part of stream) parts.push(part)
  return parts
}

describe('local-llm language model', () => {
  beforeEach(() => {
    generate.mockReset()
  })

  it('streams reasoning and text as separate, closed parts before finishing', async () => {
    generate.mockImplementation(async (_modelId, _input, { onEvent }) => {
      onEvent({ type: 'reasoning', delta: 'think' })
      onEvent({ type: 'text', delta: 'Hel' })
      onEvent({ type: 'text', delta: 'lo' })
      return RESULT
    })

    const parts = await readStream(callOptions())

    expect(parts.map((part) => part.type)).toEqual([
      'stream-start',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-end',
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'finish'
    ])
    const textIds = new Set(
      parts.filter((part) => part.type.startsWith('text-')).map((part) => (part as { id: string }).id)
    )
    expect(textIds.size).toBe(1)
    expect(parts.at(-1)).toMatchObject({
      finishReason: { unified: 'stop' },
      usage: { inputTokens: { total: 12 }, outputTokens: { total: 3 } }
    })
  })

  it('reports a failed generation as a stream error instead of hanging the stream', async () => {
    generate.mockRejectedValue(new Error('The selected local chat model is not fully downloaded'))

    const parts = await readStream(callOptions())

    expect(parts.at(-1)).toMatchObject({ type: 'error' })
  })

  it('flattens the prompt to text turns and leaves past reasoning out', async () => {
    generate.mockResolvedValue(RESULT)

    await readStream(
      callOptions({
        prompt: [
          { role: 'system', content: 'Be brief.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' }
            ]
          },
          {
            role: 'assistant',
            content: [
              { type: 'reasoning', text: 'hidden' },
              { type: 'text', text: 'answer' }
            ]
          }
        ]
      })
    )

    expect(generate.mock.calls[0][1].messages).toEqual([
      { role: 'system', text: 'Be brief.' },
      { role: 'user', text: 'a\nb' },
      { role: 'assistant', text: 'answer' }
    ])
  })

  it('refuses attachments rather than silently dropping them', async () => {
    const parts = await readStream(
      callOptions({
        prompt: [{ role: 'user', content: [{ type: 'file', data: 'aGk=', mediaType: 'image/png' }] }]
      })
    )

    expect(generate).not.toHaveBeenCalled()
    expect(parts.at(-1)).toMatchObject({ type: 'error' })
  })

  it('overrides the recommended sampling only with values the request sets', async () => {
    generate.mockResolvedValue(RESULT)

    await readStream(callOptions({ temperature: 0.2 }))

    expect(generate.mock.calls[0][1].sampling).toEqual({ temperature: 0.2 })
  })
})
