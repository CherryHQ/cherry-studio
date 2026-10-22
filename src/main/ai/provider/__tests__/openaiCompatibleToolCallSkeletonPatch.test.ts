import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { streamText, tool, type TextStreamPart, type ToolSet } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'lookup' }] }]
const complete = (index = 0, id = 'a', args = '{"x":1}') => ({
  index,
  id,
  function: { name: 'lookup', arguments: args }
})
const fragment = (index: number, args: string) => ({ index, function: { arguments: args } })
const delta = (entry: unknown) => ({ tool_calls: [entry] })

function model(deltas: unknown[], finish: string | null = 'tool_calls') {
  const events: { choices: { delta: unknown; finish_reason: string | null }[] }[] = deltas.map((value) => ({
    choices: [{ delta: value, finish_reason: null }]
  }))
  if (finish) events.push({ choices: [{ delta: {}, finish_reason: finish }] })
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`
  return createOpenAICompatible({
    name: 'replay',
    baseURL: 'https://example.com/v1',
    fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  }).chatModel('m')
}

async function read(deltas: unknown[], finish: string | null = 'tool_calls') {
  const { stream } = await model(deltas, finish).doStream({ prompt })
  const parts: LanguageModelV3StreamPart[] = []
  let rejected: unknown
  try {
    for await (const part of stream) parts.push(part)
  } catch (error) {
    rejected = error
  }
  return { parts, rejected }
}

function assertCall(parts: LanguageModelV3StreamPart[], id: string, input: string) {
  expect(parts.filter((part) => part.type === 'tool-input-start' && part.id === id)).toEqual([
    { type: 'tool-input-start', id, toolName: 'lookup' }
  ])
  expect(
    parts
      .filter((part) => part.type === 'tool-input-delta' && part.id === id)
      .map((part) => part.type === 'tool-input-delta' && part.delta)
      .join('')
  ).toBe(input)
  expect(parts.filter((part) => part.type === 'tool-call' && part.toolCallId === id)).toEqual([
    { type: 'tool-call', toolCallId: id, toolName: 'lookup', input }
  ])
}

// These cases catch rejected skeletons, duplicate initialization, and argument mixing across indices.
describe('OpenAI-compatible indexed tool-call skeleton patch', () => {
  it.each([
    {
      name: 'buffers identity and arguments while preserving reasoning and text',
      deltas: [
        { reasoning_content: 'R' },
        { content: 'T' },
        delta({ index: 0 }),
        delta({ index: 0, id: 'a' }),
        delta(fragment(0, '{"x":')),
        delta({ index: 0, function: { name: 'lookup', arguments: '1}' } })
      ],
      ids: ['a']
    },
    {
      name: 'initializes only once after repeated skeletons',
      deltas: [delta({ index: 0 }), delta({ index: 0 }), delta(complete())],
      ids: ['a']
    },
    {
      name: 'emits an empty argument delta for a skeleton after initialization',
      deltas: [delta(complete(0, 'a', '{"x":')), delta({ index: 0 }), delta(fragment(0, '1}'))],
      ids: ['a']
    },
    {
      name: 'keeps interleaved indices separate when index one initializes first',
      deltas: [
        delta({ index: 0 }),
        delta({ index: 1 }),
        delta(complete(1, 'b', '{"x":')),
        delta(complete(0, 'a', '{"x":')),
        delta(fragment(1, '2}')),
        delta(fragment(0, '1}'))
      ],
      ids: ['a', 'b']
    },
    {
      name: 'preserves a complete fragmented call without skeletons',
      deltas: [delta(complete(0, 'a', '{"x":')), delta(fragment(0, '1}'))],
      ids: ['a']
    }
  ])('$name', async ({ name, deltas, ids }) => {
    const { parts, rejected } = await read(deltas)
    expect(rejected).toBeUndefined()
    expect(parts.filter((part) => part.type === 'error')).toEqual([])
    expect(parts.filter((part) => part.type === 'tool-call')).toHaveLength(ids.length)
    for (const id of ids) assertCall(parts, id, id === 'a' ? '{"x":1}' : '{"x":2}')
    if (name.startsWith('buffers')) {
      expect(parts).toContainEqual({ type: 'reasoning-delta', id: 'reasoning-0', delta: 'R' })
      expect(parts).toContainEqual({ type: 'text-delta', id: 'txt-0', delta: 'T' })
    }
    if (name.startsWith('emits')) {
      expect(parts.filter((part) => part.type === 'tool-input-delta')).toEqual([
        { type: 'tool-input-delta', id: 'a', delta: '{"x":' },
        { type: 'tool-input-delta', id: 'a', delta: '' },
        { type: 'tool-input-delta', id: 'a', delta: '1}' }
      ])
    }
  })

  it('preserves text-only responses', async () => {
    const { parts, rejected } = await read([{ content: 'T' }], 'stop')
    expect(rejected).toBeUndefined()
    expect(parts.filter((part) => part.type === 'error')).toEqual([])
    expect(parts).toContainEqual({ type: 'text-delta', id: 'txt-0', delta: 'T' })
    expect(parts.filter((part) => part.type === 'tool-call')).toEqual([])
    expect(parts.find((part) => part.type === 'finish')).toMatchObject({ finishReason: { unified: 'stop' } })
  })

  it.each(['tool_calls', null])(
    'rejects unresolved skeletons at finish %s without fabricating calls',
    async (finish) => {
      const { parts, rejected } = await read([delta({ index: 0 })], finish)
      expect(rejected).toMatchObject({
        name: 'AI_InvalidResponseDataError',
        message: "Expected 'function.name' to be a string."
      })
      expect(parts.filter((part) => part.type === 'tool-call')).toEqual([])
    }
  )

  it('still requires an id when the name arrives', async () => {
    const { parts, rejected } = await read([delta({ index: 0, function: { name: 'lookup' } })])
    expect(rejected).toMatchObject({ name: 'AI_InvalidResponseDataError', message: "Expected 'id' to be a string." })
    expect(parts.filter((part) => part.type === 'tool-call')).toEqual([])
  })

  it.each([null, 'lookup', [], 1, { name: 1 }, { arguments: {} }])(
    'keeps invalid function values rejected: %j',
    async (value) => {
      const { parts } = await read([delta({ index: 0, id: 'a', function: value })])
      expect(parts.filter((part) => part.type === 'error')).toEqual([
        expect.objectContaining({ error: expect.objectContaining({ name: 'AI_TypeValidationError' }) })
      ])
      expect(parts.filter((part) => part.type === 'tool-call')).toEqual([])
    }
  )

  it('preserves index-less complete calls and rejects a later index-less fragment', async () => {
    const indexLess = ({ id, function: fn }: ReturnType<typeof complete>) => ({ id, function: fn })
    const first = indexLess(complete())
    const second = indexLess(complete(1, 'b', '{"x":2}'))
    const { parts, rejected } = await read([delta(first), delta(second)])
    expect(rejected).toBeUndefined()
    expect(parts.filter((part) => part.type === 'error')).toEqual([])
    assertCall(parts, 'a', '{"x":1}')
    assertCall(parts, 'b', '{"x":2}')
    const later = await read([delta(first), delta({ function: { arguments: 'ignored' } })])
    expect(later.rejected).toMatchObject({ message: "Expected 'id' to be a string." })
  })

  it('keeps a pending thought signature associated with the completed call', async () => {
    const { parts, rejected } = await read([
      delta({ index: 0, extra_content: { google: { thought_signature: 'signature' } } }),
      delta(complete())
    ])
    expect(rejected).toBeUndefined()
    expect(parts.filter((part) => part.type === 'error')).toEqual([])
    expect(parts.filter((part) => part.type === 'tool-call')).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'a',
        toolName: 'lookup',
        input: '{"x":1}',
        providerMetadata: { replay: { thoughtSignature: 'signature' } }
      }
    ])
  })

  it('rejects an unresolved index before flushing another completed call', async () => {
    const { parts, rejected } = await read([delta(complete()), delta({ index: 1 })])
    expect(rejected).toMatchObject({ message: "Expected 'function.name' to be a string." })
    expect(parts.filter((part) => part.type === 'tool-call')).toEqual([])
  })

  it.each(['', null])('preserves empty/null inner arguments: %s', async (args) => {
    const { parts, rejected } = await read([
      delta({ index: 0, id: 'a', function: { name: 'lookup', arguments: args } }),
      delta({ index: 0, function: { arguments: args } })
    ])
    expect(rejected).toBeUndefined()
    expect(parts.filter((part) => part.type === 'error')).toEqual([])
    assertCall(parts, 'a', '')
    expect(parts).toContainEqual({ type: 'tool-input-delta', id: 'a', delta: '' })
  })

  it('preserves the error part for a missing finish reason without pending calls', async () => {
    const { parts, rejected } = await read([{ content: 'T' }], null)
    expect(rejected).toBeUndefined()
    expect(parts.filter((part) => part.type === 'error')).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({ message: 'Response stream ended without a finish reason.' })
      })
    ])
    expect(parts.find((part) => part.type === 'finish')).toMatchObject({ finishReason: { unified: 'error' } })
  })

  it('keeps the non-streaming function schema required', async () => {
    const response = {
      choices: [
        { message: { role: 'assistant', content: null, tool_calls: [{ id: 'a' }] }, finish_reason: 'tool_calls' }
      ]
    }
    const nonStreaming = createOpenAICompatible({
      name: 'replay',
      baseURL: 'https://example.com/v1',
      fetch: async () => Response.json(response)
    }).chatModel('m')
    await expect(nonStreaming.doGenerate({ prompt })).rejects.toThrow('Invalid JSON response')
  })

  it.each(['{"x":', '{"x":"wrong"}'])(
    'passes raw input %s through but never executes an invalid tool',
    async (input) => {
      const { parts, rejected } = await read([delta(complete(0, 'a', input))])
      expect(rejected).toBeUndefined()
      expect(parts.filter((part) => part.type === 'error')).toEqual([])
      assertCall(parts, 'a', input)
      const executions: unknown[] = []
      const result = streamText({
        model: model([delta(complete(0, 'a', input))]),
        prompt: 'lookup',
        tools: {
          lookup: tool({
            inputSchema: z.object({ x: z.number() }),
            execute: async (value) => {
              executions.push(value)
              return value
            }
          })
        }
      })
      const output: TextStreamPart<ToolSet>[] = []
      for await (const part of result.fullStream) output.push(part)
      expect(executions).toEqual([])
      expect(output).toContainEqual(expect.objectContaining({ type: 'tool-call', toolCallId: 'a', invalid: true }))
      expect(output).toContainEqual(expect.objectContaining({ type: 'tool-error', toolCallId: 'a' }))
    }
  )
})
