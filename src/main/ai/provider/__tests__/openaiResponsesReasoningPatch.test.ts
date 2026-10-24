import { createOpenAI } from '@ai-sdk/openai'
import { OpenAIResponsesLanguageModel } from '@ai-sdk/openai/internal'
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { readUIMessageStream, streamText } from 'ai'
import { describe, expect, it } from 'vitest'

const prompt: LanguageModelV3CallOptions['prompt'] = [
  { role: 'user', content: [{ type: 'text', text: 'Think before answering.' }] }
]

// Guards patches/@ai-sdk__openai@3.0.109.patch. DeepSeek's Responses API emits
// response.reasoning_text.delta rather than OpenAI's reasoning summary delta event.
describe('patched @ai-sdk/openai Responses model capabilities', () => {
  it('does not send the Codex-only ultra effort to standard OpenAI Astra', async () => {
    let requestBody: { reasoning?: { effort?: string } } = {}
    const model = createOpenAI({
      apiKey: 'sk-test',
      baseURL: 'https://api.openai.com/v1',
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(init?.body as string)
        return new Response(
          JSON.stringify({
            id: 'resp_1',
            created_at: 0,
            model: 'gpt-6-astra',
            status: 'completed',
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 }
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      }
    }).responses('gpt-6-astra')

    const result = await model.doGenerate({
      prompt,
      providerOptions: { openai: { reasoningEffort: 'ultra' } }
    })

    expect(requestBody.reasoning?.effort).toBeUndefined()
    expect(result.warnings).toContainEqual(expect.objectContaining({ type: 'unsupported', feature: 'reasoningEffort' }))
  })
})

// Without the patch, the SDK accepts the event as an unknown chunk and silently
// drops the reasoning text before it reaches Cherry Studio's stream pipeline.
describe('patched @ai-sdk/openai Responses reasoning parser', () => {
  it('replays item-backed raw reasoning content when store is false', async () => {
    let requestBody: any
    const model = createOpenAI({
      apiKey: 'sk-test',
      baseURL: 'https://example.com/v1',
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(init?.body as string)
        return new Response(
          JSON.stringify({
            id: 'resp_1',
            created_at: 0,
            model: 'deepseek-v4-flash',
            status: 'completed',
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 }
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      }
    }).responses('deepseek-v4-flash')

    await model.doGenerate({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 'First step',
              providerOptions: { openai: { itemId: 'reasoning-item', rawReasoningContent: true } }
            }
          ]
        },
        { role: 'user', content: [{ type: 'text', text: 'Continue.' }] }
      ],
      providerOptions: { openai: { store: false } }
    })

    expect(requestBody.input).toContainEqual({
      type: 'reasoning',
      summary: [],
      content: [{ type: 'reasoning_text', text: 'First step' }]
    })
  })

  it('normalizes response.reasoning_text.delta into reasoning stream parts', async () => {
    const events = [
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'reasoning', id: 'reasoning-item', encrypted_content: null }
      },
      { type: 'response.reasoning_text.delta', item_id: 'reasoning-item', delta: 'First ' },
      { type: 'response.reasoning_text.delta', item_id: 'reasoning-item', delta: 'step' },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'reasoning', id: 'reasoning-item', encrypted_content: null }
      },
      {
        type: 'response.completed',
        response: {
          incomplete_details: null,
          service_tier: null,
          usage: {
            input_tokens: 3,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 2,
            output_tokens_details: { reasoning_tokens: 2 }
          }
        }
      }
    ]
    const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
    const model = createOpenAI({
      apiKey: 'sk-test',
      baseURL: 'https://example.com/v1',
      fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    }).responses('deepseek-v4-flash')

    const result = await model.doStream({ prompt })
    const reader = result.stream.getReader()
    const chunks: LanguageModelV3StreamPart[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const reasoningChunks: Array<
      { type: 'reasoning-start' | 'reasoning-end'; id: string } | { type: 'reasoning-delta'; id: string; delta: string }
    > = []
    for (const chunk of chunks) {
      switch (chunk.type) {
        case 'reasoning-start':
        case 'reasoning-end':
          reasoningChunks.push({ type: chunk.type, id: chunk.id })
          break
        case 'reasoning-delta':
          reasoningChunks.push({ type: chunk.type, id: chunk.id, delta: chunk.delta })
          break
      }
    }

    expect(reasoningChunks).toEqual([
      { type: 'reasoning-start', id: 'reasoning-item:0' },
      { type: 'reasoning-delta', id: 'reasoning-item:0', delta: 'First ' },
      { type: 'reasoning-delta', id: 'reasoning-item:0', delta: 'step' },
      { type: 'reasoning-end', id: 'reasoning-item:0' }
    ])
  })
})

const itemId = 'rs_contract'
const rawDelta = (delta: string, id = itemId) => ({ type: 'response.reasoning_text.delta', item_id: id, delta })
const summaryDelta = (index: number, delta: string) => ({
  type: 'response.reasoning_summary_text.delta',
  item_id: itemId,
  summary_index: index,
  delta
})
const itemEvent = (phase: 'added' | 'done', content: Record<string, unknown> = {}, id = itemId) => ({
  type: `response.output_item.${phase}`,
  output_index: 0,
  item: { type: 'reasoning', id, ...content }
})
const summaryPart = (phase: 'added' | 'done', index: number) => ({
  type: `response.reasoning_summary_part.${phase}`,
  item_id: itemId,
  summary_index: index
})

function contractModel(events: unknown[], internal = false) {
  events = [
    ...events,
    {
      type: 'response.completed',
      response: {
        incomplete_details: null,
        service_tier: null,
        usage: {
          input_tokens: 3,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 2,
          output_tokens_details: { reasoning_tokens: 2 }
        }
      }
    }
  ]
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
  const fetch = async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  return internal
    ? new OpenAIResponsesLanguageModel('deepseek-v4-flash', {
        provider: 'openai.responses',
        url: () => 'https://example.com/v1/responses',
        headers: () => ({}),
        fetch,
        generateId: () => 'id'
      })
    : createOpenAI({ apiKey: 'sk-test', baseURL: 'https://example.com/v1', fetch }).responses('deepseek-v4-flash')
}

async function collectContract(model: ReturnType<typeof contractModel>, store = true) {
  const { stream } = await model.doStream({ prompt, providerOptions: { openai: { store } } })
  const chunks: LanguageModelV3StreamPart[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function reasoningProjection(chunks: LanguageModelV3StreamPart[]) {
  return chunks.flatMap<{ type: 'reasoning-start' | 'reasoning-delta' | 'reasoning-end'; id: string; delta?: string }>(
    (chunk) => {
      if (chunk.type === 'reasoning-delta') return [{ type: chunk.type, id: chunk.id, delta: chunk.delta }]
      if (chunk.type === 'reasoning-start' || chunk.type === 'reasoning-end')
        return [{ type: chunk.type, id: chunk.id }]
      return []
    }
  )
}

function expectFinished(chunks: LanguageModelV3StreamPart[]) {
  expect(chunks.filter((chunk) => chunk.type === 'error')).toEqual([])
  expect(chunks.filter((chunk) => chunk.type === 'finish').map((chunk) => chunk.finishReason.unified)).toEqual(['stop'])
}

function expectSinglePart(chunks: LanguageModelV3StreamPart[], texts: string[], id = `${itemId}:0`) {
  expectFinished(chunks)
  expect(reasoningProjection(chunks)).toEqual([
    { type: 'reasoning-start', id },
    ...texts.map((delta) => ({ type: 'reasoning-delta', id, delta })),
    { type: 'reasoning-end', id }
  ])
}

async function expectAssembled(model: ReturnType<typeof contractModel>, text: string) {
  const result = streamText({ model, prompt: 'Think.', maxRetries: 0 })
  const errors: unknown[] = []
  for await (const part of result.fullStream) if (part.type === 'error') errors.push(part.error)
  expect(errors).toEqual([])
  expect(await result.reasoningText).toBe(text)
  expect((await result.reasoning).map((part) => ({ type: part.type, text: part.text }))).toEqual([
    { type: 'reasoning', text }
  ])
  expect(await result.finishReason).toBe('stop')
}

const deltaKinds = ['raw', 'summary'] as const
const contractDelta = (kind: (typeof deltaKinds)[number], text: string) =>
  kind === 'raw' ? rawDelta(text) : summaryDelta(0, text)

describe('Responses reasoning lifecycle contract', () => {
  // Catches missing initialization before raw deltas and the resulting consumer failure.
  it.each([false, true])('R1 delta-only initializes one part (internal=%s)', async (internal) => {
    const model = contractModel(
      [rawDelta('First '), rawDelta('step'), itemEvent('done', { encrypted_content: 'final' })],
      internal
    )
    const chunks = await collectContract(model)
    expectSinglePart(chunks, ['First ', 'step'])
    expect(chunks.find((part) => part.type === 'reasoning-start')?.providerMetadata?.openai).toEqual({
      itemId,
      reasoningEncryptedContent: null
    })
    expect(chunks.find((part) => part.type === 'reasoning-end')?.providerMetadata?.openai).toEqual({
      itemId,
      reasoningEncryptedContent: 'final'
    })
    await expectAssembled(model, 'First step')
  })

  // Catches missing initialization in summary deltas under both closing policies.
  it.each([true, false])('R2 summary without added closes once (store=%s)', async (store) => {
    const chunks = await collectContract(
      contractModel([
        summaryDelta(0, 'First '),
        summaryDelta(0, 'step'),
        summaryPart('done', 0),
        itemEvent('done', { encrypted_content: 'final' })
      ]),
      store
    )
    expectSinglePart(chunks, ['First ', 'step'])
    if (!store)
      expect(
        chunks.find((part) => part.type === 'reasoning-end')?.providerMetadata?.openai?.reasoningEncryptedContent
      ).toBe('final')
  })

  // Catches a late added restarting a synthetic part and splitting the assembled text.
  it.each(deltaKinds.flatMap((kind) => [false, true].map((internal) => ({ kind, internal }))))(
    'R3 late added is idempotent ($kind, internal=$internal)',
    async ({ kind, internal }) => {
      const model = contractModel(
        [
          contractDelta(kind, 'First '),
          itemEvent('added', { encrypted_content: 'late' }),
          contractDelta(kind, 'step'),
          itemEvent('done', { encrypted_content: 'final' })
        ],
        internal
      )
      const chunks = await collectContract(model)
      expectSinglePart(chunks, ['First ', 'step'])
      expect(
        chunks.find((part) => part.type === 'reasoning-end')?.providerMetadata?.openai?.reasoningEncryptedContent
      ).toBe('final')
      await expectAssembled(model, 'First step')
      let message
      const result = streamText({ model, prompt: 'Think.', maxRetries: 0 })
      for await (const current of readUIMessageStream({
        stream: result.toUIMessageStream({ sendReasoning: true }),
        terminateOnError: true
      }))
        message = current
      expect(
        message?.parts
          .filter((part) => part.type === 'reasoning')
          .map((part) => ({ text: part.text, state: part.state }))
      ).toEqual([{ text: 'First step', state: 'done' }])
    }
  )

  // Catches duplicate added resetting an already concluded summary lifecycle.
  it('R4 duplicate added preserves the concluded part', async () => {
    const model = contractModel([
      itemEvent('added'),
      summaryDelta(0, 'Summary'),
      summaryPart('done', 0),
      itemEvent('added'),
      itemEvent('done')
    ])
    expectSinglePart(await collectContract(model), ['Summary'])
    await expectAssembled(model, 'Summary')
    let message
    const result = streamText({ model, prompt: 'Think.', maxRetries: 0 })
    for await (const current of readUIMessageStream({
      stream: result.toUIMessageStream({ sendReasoning: true }),
      terminateOnError: true
    }))
      message = current
    expect(
      message?.parts.filter((part) => part.type === 'reasoning').map((part) => ({ text: part.text, state: part.state }))
    ).toEqual([{ text: 'Summary', state: 'done' }])
  })

  // Catches lost can-conclude state and null/absent added clearing cached ciphertext.
  it.each([
    { label: 'omitted', second: {}, expected: 'enc-a' },
    { label: 'null', second: { encrypted_content: null }, expected: 'enc-a' },
    { label: 'replacement', second: { encrypted_content: 'enc-b' }, expected: 'enc-b' }
  ])('R5 late ciphertext survives subsequent summary ($label)', async ({ second, expected }) => {
    const chunks = await collectContract(
      contractModel([
        summaryDelta(0, 'First'),
        summaryPart('done', 0),
        itemEvent('added', { encrypted_content: 'enc-a' }),
        itemEvent('added', second),
        summaryPart('added', 1),
        summaryDelta(1, 'Next'),
        summaryPart('done', 1),
        itemEvent('done', { encrypted_content: 'final' })
      ]),
      false
    )
    expectFinished(chunks)
    expect(reasoningProjection(chunks)).toEqual([
      { type: 'reasoning-start', id: `${itemId}:0` },
      { type: 'reasoning-delta', id: `${itemId}:0`, delta: 'First' },
      { type: 'reasoning-end', id: `${itemId}:0` },
      { type: 'reasoning-start', id: `${itemId}:1` },
      { type: 'reasoning-delta', id: `${itemId}:1`, delta: 'Next' },
      { type: 'reasoning-end', id: `${itemId}:1` }
    ])
    expect(
      chunks.filter((part) => part.type === 'reasoning-start').find((part) => part.id === `${itemId}:1`)
        ?.providerMetadata?.openai?.reasoningEncryptedContent
    ).toBe(expected)
    expect(
      chunks.filter((part) => part.type === 'reasoning-end').at(-1)?.providerMetadata?.openai?.reasoningEncryptedContent
    ).toBe('final')
  })

  // Catches using a single stream-wide started flag instead of per-item state.
  it('R6 interleaved items retain separate lifecycles', async () => {
    const chunks = await collectContract(
      contractModel([
        rawDelta('A', 'rs_a'),
        rawDelta('B', 'rs_b'),
        rawDelta('2', 'rs_a'),
        itemEvent('done', {}, 'rs_a'),
        itemEvent('done', {}, 'rs_b')
      ])
    )
    expectFinished(chunks)
    for (const [id, texts] of [
      ['rs_a:0', ['A', '2']],
      ['rs_b:0', ['B']]
    ] as const) {
      expectSinglePart(
        chunks.filter((part) => !part.type.startsWith('reasoning-') || ('id' in part && part.id === id)),
        [...texts],
        id
      )
    }
  })

  // Guards the existing normal summary lifecycle against extra synthetic starts.
  it.each([true, false])('G2 normal summary remains unchanged (store=%s)', async (store) => {
    const chunks = await collectContract(
      contractModel([
        itemEvent('added'),
        summaryDelta(0, 'Summary'),
        summaryPart('done', 0),
        itemEvent('done', { encrypted_content: 'final' })
      ]),
      store
    )
    expectSinglePart(chunks, ['Summary'])
    if (!store)
      expect(
        chunks.find((part) => part.type === 'reasoning-end')?.providerMetadata?.openai?.reasoningEncryptedContent
      ).toBe('final')
  })

  // Guards modeled schema failures against being swallowed by recovery.
  it('G3 malformed reasoning added remains an explicit schema error', async () => {
    const chunks = await collectContract(
      contractModel([{ type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning' } }])
    )
    const errors = chunks.filter((part) => part.type === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toMatchObject({ name: 'AI_TypeValidationError' })
    expect(reasoningProjection(chunks)).toEqual([])
    expect(chunks.filter((part) => part.type === 'finish').map((part) => part.finishReason.unified)).toEqual(['error'])
  })

  // Guards unknown item fallback against creating a fictitious reasoning part.
  it('G3 unknown item type produces no reasoning parts', async () => {
    const chunks = await collectContract(contractModel([itemEvent('added', { type: 'future_reasoning' })]))
    expectFinished(chunks)
    expect(reasoningProjection(chunks)).toEqual([])
  })
})
