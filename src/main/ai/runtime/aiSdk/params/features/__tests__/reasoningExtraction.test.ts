import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { createOllamaWithImageModel } from '../../../../../provider/custom/ollama/ollamaProvider'
import { reasoningExtractionFeature } from '../reasoningExtraction'

const PROMPT: LanguageModelV3CallOptions['prompt'] = [
  { role: 'user', content: [{ type: 'text', text: 'Explain the answer' }] }
]

interface OllamaMessageDelta {
  content: string
  thinking?: string
}

function ollamaChunk(message: OllamaMessageDelta, done = false): string {
  return JSON.stringify({
    model: 'qwen3.6:27b-mtp-q8_0',
    created_at: '2026-08-19T00:00:00Z',
    done,
    message: { role: 'assistant', ...message },
    ...(done ? { done_reason: 'stop', prompt_eval_count: 1, eval_count: 2 } : {})
  })
}

async function getOllamaReasoningMiddleware(): Promise<LanguageModelMiddleware[]> {
  const scope = {
    endpointType: ENDPOINT_TYPE.OLLAMA_CHAT,
    model: { id: 'ollama::qwen3.6:27b-mtp-q8_0' }
  } as never

  if (reasoningExtractionFeature.applies?.(scope) === false) return []

  const middlewares: LanguageModelMiddleware[] = []
  for (const plugin of reasoningExtractionFeature.contributeModelAdapters?.(scope) ?? []) {
    await plugin.configureContext?.({ middlewares } as never)
  }
  return middlewares
}

async function streamOllama(chunks: string[]): Promise<LanguageModelV3StreamPart[]> {
  const fetch = () =>
    Promise.resolve(
      new Response(`${chunks.join('\n')}\n`, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' }
      })
    )
  const baseModel = createOllamaWithImageModel({ baseURL: 'https://ollama.example/api', fetch }).languageModel(
    'qwen3.6:27b-mtp-q8_0'
  )
  const middlewares = await getOllamaReasoningMiddleware()
  const model = middlewares.length > 0 ? wrapLanguageModel({ model: baseModel, middleware: middlewares }) : baseModel
  const result = await model.doStream({ prompt: PROMPT })

  const parts: LanguageModelV3StreamPart[] = []
  for await (const part of result.stream) parts.push(part)
  return parts
}

function joinedDelta(parts: LanguageModelV3StreamPart[], type: 'reasoning-delta' | 'text-delta'): string {
  return parts
    .filter((part): part is Extract<LanguageModelV3StreamPart, { type: typeof type }> => part.type === type)
    .map((part) => part.delta)
    .join('')
}

describe('reasoningExtractionFeature', () => {
  it('extracts inline Ollama reasoning when think tags are split across stream chunks', async () => {
    const parts = await streamOllama([
      ollamaChunk({ content: '<thi' }),
      ollamaChunk({ content: 'nk>first step' }),
      ollamaChunk({ content: ' and second step</th' }),
      ollamaChunk({ content: 'ink>The answer is 42.' }),
      ollamaChunk({ content: '' }, true)
    ])

    expect(joinedDelta(parts, 'reasoning-delta')).toBe('first step and second step')
    expect(joinedDelta(parts, 'text-delta')).toBe('The answer is 42.')
  })

  it('preserves Ollama native thinking without duplicating it', async () => {
    const parts = await streamOllama([
      ollamaChunk({ content: '', thinking: 'native thought' }),
      ollamaChunk({ content: 'Native answer.' }),
      ollamaChunk({ content: '' }, true)
    ])

    expect(joinedDelta(parts, 'reasoning-delta')).toBe('native thought')
    expect(joinedDelta(parts, 'text-delta')).toBe('Native answer.')
  })

  it('leaves ordinary Ollama text unchanged', async () => {
    const parts = await streamOllama([ollamaChunk({ content: 'Plain answer.' }), ollamaChunk({ content: '' }, true)])

    expect(joinedDelta(parts, 'reasoning-delta')).toBe('')
    expect(joinedDelta(parts, 'text-delta')).toBe('Plain answer.')
  })
})
