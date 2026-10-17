import { OpenAICompatibleChatLanguageModel } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { streamText, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { createOllamaWithImageModel } from '../../../../../provider/custom/ollama/ollamaProvider'
import { reasoningExtractionFeature } from '../reasoningExtraction'
import { createAnchoredReasoningExtraction } from '../reasoningExtractionMiddleware'

const PROMPT: LanguageModelV3CallOptions['prompt'] = [
  { role: 'user', content: [{ type: 'text', text: 'Explain the answer' }] }
]

const OPEN_TAG = '<think>'
const CLOSE_TAG = '</think>'

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

async function streamWith(
  model: LanguageModelV3,
  middleware: LanguageModelMiddleware[]
): Promise<LanguageModelV3StreamPart[]> {
  const wrapped = middleware.length > 0 ? wrapLanguageModel({ model, middleware }) : model
  const result = await wrapped.doStream({ prompt: PROMPT })

  const parts: LanguageModelV3StreamPart[] = []
  for await (const part of result.stream) parts.push(part)
  return parts
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
  return streamWith(baseModel, await getOllamaReasoningMiddleware())
}

/** openai-compatible chat model whose SSE stream is the given deltas, verbatim. */
function compatibleModel(deltas: Array<Record<string, unknown>>): LanguageModelV3 {
  const payloads = deltas.map((delta, index) => ({
    id: 'cmpl-1',
    created: 0,
    model: 'deepseek-flash',
    choices: [{ index: 0, delta, finish_reason: index === deltas.length - 1 ? 'stop' : null }]
  }))
  const body = `${payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join('')}data: [DONE]\n\n`
  return new OpenAICompatibleChatLanguageModel('deepseek-flash', {
    provider: 'test',
    url: ({ path }) => `https://compatible.example/v1${path}`,
    headers: () => ({}),
    fetch: async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
  })
}

function streamCompatible(deltas: Array<Record<string, unknown>>): Promise<LanguageModelV3StreamPart[]> {
  return streamWith(compatibleModel(deltas), [createAnchoredReasoningExtraction('think')])
}

/** Emits the given parts verbatim, for structural cases an SSE fixture cannot express. */
function fakeModel(
  parts: LanguageModelV3StreamPart[],
  options: { holdOpen?: boolean; onCancel?: () => void } = {}
): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'test',
    modelId: 'fake',
    supportedUrls: {},
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          for (const part of parts) controller.enqueue(part)
          if (!options.holdOpen) controller.close()
        },
        cancel() {
          options.onCancel?.()
        }
      })
    }),
    doGenerate: async () => ({
      content: [],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      warnings: []
    })
  } as unknown as LanguageModelV3
}

function joinedDelta(parts: LanguageModelV3StreamPart[], type: 'reasoning-delta' | 'text-delta'): string {
  return parts
    .filter((part): part is Extract<LanguageModelV3StreamPart, { type: typeof type }> => part.type === type)
    .map((part) => part.delta)
    .join('')
}

function partTypes(parts: LanguageModelV3StreamPart[]): string[] {
  return parts.map((part) => part.type)
}

function finishPart(): LanguageModelV3StreamPart {
  return {
    type: 'finish',
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 0, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 0, text: undefined, reasoning: undefined }
    }
  }
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

describe('anchored inline reasoning extraction', () => {
  it('keeps a mid-text literal tag in the answer when the wire streamed structured reasoning', async () => {
    const parts = await streamCompatible([
      { reasoning_content: 'weighing options' },
      { content: '1234567890' },
      { content: OPEN_TAG },
      { content: 'tail' }
    ])

    expect(joinedDelta(parts, 'text-delta')).toBe(`1234567890${OPEN_TAG}tail`)
    expect(joinedDelta(parts, 'reasoning-delta')).toBe('weighing options')
  })

  it('keeps a leading literal tag as content when the wire streamed structured reasoning', async () => {
    const parts = await streamCompatible([
      { reasoning_content: 'weighing options' },
      { content: `${OPEN_TAG}not reasoning` }
    ])

    expect(joinedDelta(parts, 'text-delta')).toBe(`${OPEN_TAG}not reasoning`)
    expect(joinedDelta(parts, 'reasoning-delta')).toBe('weighing options')
  })

  it('extracts a leading tag block across chunk splits and orders reasoning before the answer', async () => {
    const parts = await streamCompatible([
      { content: '\n\n<th' },
      { content: 'ink>deep ' },
      { content: 'thought</th' },
      { content: 'ink>the answer' }
    ])

    expect(joinedDelta(parts, 'reasoning-delta')).toBe('deep thought')
    expect(joinedDelta(parts, 'text-delta')).toBe('\n\nthe answer')
    const types = partTypes(parts)
    expect(types.indexOf('reasoning-start')).toBeLessThan(types.indexOf('text-start'))
    expect(types.indexOf('reasoning-end')).toBeLessThan(types.indexOf('text-start'))
  })

  it('leaves a second literal tag in the answer as content', async () => {
    const parts = await streamCompatible([
      { content: `${OPEN_TAG}first block${CLOSE_TAG}answer ` },
      { content: `${OPEN_TAG}literal</think` },
      { content: '>' }
    ])

    expect(joinedDelta(parts, 'reasoning-delta')).toBe('first block')
    expect(joinedDelta(parts, 'text-delta')).toBe(`answer ${OPEN_TAG}literal${CLOSE_TAG}`)
  })

  it('leaves a mid-text tag alone when the wire streamed no structured reasoning', async () => {
    const parts = await streamCompatible([{ content: 'echo ' }, { content: OPEN_TAG }, { content: 'tail' }])

    expect(joinedDelta(parts, 'reasoning-delta')).toBe('')
    expect(joinedDelta(parts, 'text-delta')).toBe(`echo ${OPEN_TAG}tail`)
  })

  it('keeps a trailing partial tag that no closing tag follows', async () => {
    const parts = await streamCompatible([{ content: 'answer <thi' }])

    expect(joinedDelta(parts, 'text-delta')).toBe('answer <thi')
  })

  it('closes an unclosed leading block before the finish chunk', async () => {
    const parts = await streamCompatible([{ content: `${OPEN_TAG}still thinking` }])

    expect(joinedDelta(parts, 'reasoning-delta')).toBe('still thinking')
    expect(joinedDelta(parts, 'text-delta')).toBe('')
    const types = partTypes(parts)
    expect(types).toContain('reasoning-end')
    expect(types.indexOf('reasoning-end')).toBeLessThan(types.indexOf('finish'))
  })

  it('passes non-text chunks through while probing and never re-anchors a later text part', async () => {
    const parts = await streamWith(
      fakeModel([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't0' },
        { type: 'text-delta', id: 't0', delta: 'plain ' },
        { type: 'tool-input-start', id: 'call-1', toolName: 'read' },
        { type: 'text-end', id: 't0' },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: `${OPEN_TAG}second part` },
        { type: 'text-end', id: 't1' },
        finishPart()
      ] as LanguageModelV3StreamPart[]),
      [createAnchoredReasoningExtraction('think')]
    )

    expect(joinedDelta(parts, 'reasoning-delta')).toBe('')
    expect(joinedDelta(parts, 'text-delta')).toBe(`plain ${OPEN_TAG}second part`)
    expect(partTypes(parts)).toContain('tool-input-start')
  })

  it('synthesises nothing for a stream without text', async () => {
    const streamParts: LanguageModelV3StreamPart[] = [
      { type: 'stream-start', warnings: [] },
      { type: 'reasoning-start', id: 'reasoning-0' },
      { type: 'reasoning-delta', id: 'reasoning-0', delta: 'native' },
      { type: 'reasoning-end', id: 'reasoning-0' },
      finishPart()
    ]
    const parts = await streamWith(fakeModel(streamParts), [createAnchoredReasoningExtraction('think')])

    expect(parts).toEqual(streamParts)
  })

  it('cancels the source stream when the consumer stops reading', async () => {
    let cancelled = false
    const wrapped = wrapLanguageModel({
      model: fakeModel(
        [
          { type: 'text-start', id: 't0' },
          { type: 'text-delta', id: 't0', delta: 'partial' }
        ] as LanguageModelV3StreamPart[],
        {
          holdOpen: true,
          onCancel: () => {
            cancelled = true
          }
        }
      ),
      middleware: [createAnchoredReasoningExtraction('think')]
    })
    const { stream } = await wrapped.doStream({ prompt: PROMPT })
    const reader = stream.getReader()
    await reader.read()
    await reader.cancel()

    expect(cancelled).toBe(true)
  })

  it('drives a well-formed UI message stream for a reply that only echoes a tag', async () => {
    const wrapped = wrapLanguageModel({
      model: compatibleModel([
        { reasoning_content: 'planning' },
        { content: '1234567890' },
        { content: OPEN_TAG },
        { content: 'literal' }
      ]),
      middleware: [createAnchoredReasoningExtraction('think')]
    })

    const result = streamText({ model: wrapped, prompt: 'echo the tag' })
    const uiChunks: unknown[] = []
    // Consuming the stream is the assertion: a malformed part sequence throws.
    for await (const chunk of result.toUIMessageStream()) uiChunks.push(chunk)

    expect(uiChunks.length).toBeGreaterThan(0)
    expect(await result.text).toBe(`1234567890${OPEN_TAG}literal`)
  })
})
