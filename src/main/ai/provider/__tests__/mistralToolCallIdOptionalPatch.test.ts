import { createMistral } from '@ai-sdk/mistral'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import {
  convertToModelMessages,
  readUIMessageStream,
  streamText,
  tool,
  type TextStreamPart,
  type ToolSet,
  type UIMessage
} from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'lookup' }] }]
const delta = (entry: unknown) => ({ content: '', tool_calls: [entry] })
const complete = (index = 0, id = 'native001', args = '{"query":"cherry"}') => ({
  index,
  id,
  function: { name: 'lookup', arguments: args }
})
const reported = [
  delta({ index: 0, function: { name: '', arguments: '{"query": "' } }),
  delta({ index: 0, id: 'late-id', function: { name: 'lookup', arguments: 'cherry"}' } })
]

function model(deltas: unknown[], finish: string | null = 'tool_calls', done = true) {
  const chunks = deltas.map((value, index) => ({
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'm',
    choices: [{ index: 0, delta: value, finish_reason: index === deltas.length - 1 ? finish : null }]
  }))
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '')
  return createMistral({
    apiKey: 'test',
    fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  })('m')
}

async function read(deltas: unknown[], finish: string | null = 'tool_calls', done = true) {
  const { stream } = await model(deltas, finish, done).doStream({ prompt })
  const parts: LanguageModelV3StreamPart[] = []
  let rejected: unknown
  try {
    for await (const part of stream) parts.push(part)
  } catch (error) {
    rejected = error
  }
  return { parts, rejected }
}

function calls(parts: LanguageModelV3StreamPart[]) {
  return parts.filter((part) => part.type === 'tool-call')
}

function assertStable(parts: LanguageModelV3StreamPart[], input: string, name = 'lookup') {
  const result = calls(parts)
  expect(result).toHaveLength(1)
  const id = result[0].toolCallId
  expect(id).toEqual(expect.any(String))
  expect(id.length).toBeGreaterThan(0)
  expect(result[0]).toEqual({ type: 'tool-call', toolCallId: id, toolName: name, input })
  expect(parts.filter((part) => part.type === 'tool-input-start')).toEqual([
    expect.objectContaining({ type: 'tool-input-start', id, toolName: name })
  ])
  expect(parts.filter((part) => part.type === 'tool-input-end')).toEqual([{ type: 'tool-input-end', id }])
  const deltas = parts.filter((part) => part.type === 'tool-input-delta')
  expect(deltas.every((part) => part.id === id)).toBe(true)
  expect(deltas.map((part) => part.delta).join('')).toBe(input)
}

describe('Mistral tool-call delta patch', () => {
  it('assembles the reported missing-id delta with a later id and name', async () => {
    const { parts, rejected } = await read(reported)
    expect(rejected).toBeUndefined()
    expect(parts.filter((part) => part.type === 'error')).toEqual([])
    assertStable(parts, '{"query": "cherry"}')
  })

  it('rejects an empty name that never becomes known', async () => {
    const { parts, rejected } = await read([delta({ id: 'a', function: { name: '', arguments: '{}' } })])
    expect(rejected).toMatchObject({
      name: 'AI_InvalidResponseDataError',
      message: "Expected 'function.name' to be a string."
    })
    expect(parts.filter((part) => part.type === 'tool-input-start' || part.type === 'tool-call')).toEqual([])
  })

  it('keeps the tool name and id through the UI message history round trip', async () => {
    const result = streamText({
      model: model(reported),
      prompt: 'lookup',
      tools: { lookup: tool({ inputSchema: z.object({ query: z.string() }), execute: async (value) => value }) }
    })
    let message: UIMessage | undefined
    for await (const current of readUIMessageStream({ stream: result.toUIMessageStream() })) message = current
    expect(message).toBeDefined()
    expect(message!.parts.map((part) => part.type)).not.toContain('tool-')
    const history = await convertToModelMessages([message!])
    const assistant = history.find((item) => item.role === 'assistant')
    const toolMessage = history.find((item) => item.role === 'tool')
    const call =
      typeof assistant?.content === 'string' ? undefined : assistant?.content.find((part) => part.type === 'tool-call')
    const output = toolMessage?.content.find((part) => part.type === 'tool-result')
    expect(call).toMatchObject({ toolName: 'lookup', toolCallId: expect.any(String) })
    expect(call?.toolCallId).not.toBe('')
    expect(output).toMatchObject({ toolName: 'lookup', toolCallId: call?.toolCallId })
  })

  it('keeps index-less pending wire ids separate', async () => {
    const { parts, rejected } = await read([
      delta({ id: 'a', function: { arguments: '{"query":"' } }),
      delta({ id: 'b', function: { arguments: '{"query":"' } }),
      delta({ id: 'a', function: { name: 'lookup', arguments: 'one"}' } }),
      delta({ id: 'b', function: { name: 'lookup', arguments: 'two"}' } })
    ])
    expect(rejected).toBeUndefined()
    expect(calls(parts)).toEqual([
      { type: 'tool-call', toolCallId: 'a', toolName: 'lookup', input: '{"query":"one"}' },
      { type: 'tool-call', toolCallId: 'b', toolName: 'lookup', input: '{"query":"two"}' }
    ])
  })

  it('buffers index-only skeletons and early arguments', async () => {
    const { parts, rejected } = await read([
      delta({ index: 0 }),
      delta({ index: 0, function: { arguments: '{"query":' } }),
      delta(complete(0, 'a', '"cherry"}'))
    ])
    expect(rejected).toBeUndefined()
    assertStable(parts, '{"query":"cherry"}')
  })

  it('generates a stable id when every fragment lacks one', async () => {
    const { parts, rejected } = await read([
      delta({ index: 0, function: { name: 'lookup', arguments: '{"query":' } }),
      delta({ index: 0, function: { arguments: '"cherry"}' } })
    ])
    expect(rejected).toBeUndefined()
    assertStable(parts, '{"query":"cherry"}')
  })

  it('accepts a complete call without an id', async () => {
    const { parts, rejected } = await read([
      delta({ index: 0, function: { name: 'lookup', arguments: '{"query":"cherry"}' } })
    ])
    expect(rejected).toBeUndefined()
    assertStable(parts, '{"query":"cherry"}')
  })

  it('preserves every part of a native single-chunk call', async () => {
    const { parts, rejected } = await read([delta(complete())])
    expect(rejected).toBeUndefined()
    expect(parts).toEqual([
      { type: 'stream-start', warnings: [] },
      { type: 'response-metadata', id: 'c1', timestamp: new Date(1000), modelId: 'm' },
      { type: 'tool-input-start', id: 'native001', toolName: 'lookup' },
      { type: 'tool-input-delta', id: 'native001', delta: '{"query":"cherry"}' },
      { type: 'tool-input-end', id: 'native001' },
      { type: 'tool-call', toolCallId: 'native001', toolName: 'lookup', input: '{"query":"cherry"}' },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: {
          inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: undefined, text: undefined, reasoning: undefined },
          raw: undefined
        }
      }
    ])
  })

  it.each([
    [true, 'tool_calls'],
    [true, null],
    [false, null]
  ] as const)('rejects unresolved skeleton on done=%s finish=%s', async (done, finish) => {
    const { parts, rejected } = await read([delta({ index: 0 })], finish, done)
    expect(rejected).toMatchObject({
      name: 'AI_InvalidResponseDataError',
      message: "Expected 'function.name' to be a string."
    })
    expect(calls(parts)).toEqual([])
  })

  it('checks all skeletons before emitting any final call', async () => {
    const { parts, rejected } = await read([delta(complete()), delta({ index: 1 })])
    expect(rejected).toMatchObject({
      name: 'AI_InvalidResponseDataError',
      message: "Expected 'function.name' to be a string."
    })
    expect(calls(parts)).toEqual([])
  })

  it('keeps interleaved calls separate', async () => {
    const { parts, rejected } = await read([
      delta(complete(0, 'a', '{"query":"')),
      delta(complete(1, 'b', '{"query":"')),
      delta({ index: 1, function: { arguments: 'two"}' } }),
      delta({ index: 0, function: { arguments: 'one"}' } })
    ])
    expect(rejected).toBeUndefined()
    expect(calls(parts)).toEqual([
      { type: 'tool-call', toolCallId: 'a', toolName: 'lookup', input: '{"query":"one"}' },
      { type: 'tool-call', toolCallId: 'b', toolName: 'lookup', input: '{"query":"two"}' }
    ])
  })

  it.each([null, 'x', [], 1])('rejects invalid function %j', async (value) => {
    const { parts } = await read([delta({ index: 0, function: value })])
    expect(parts.filter((part) => part.type === 'error')).toEqual([
      expect.objectContaining({ error: expect.objectContaining({ name: 'AI_TypeValidationError' }) })
    ])
    expect(calls(parts)).toEqual([])
  })

  it('pairs the real SDK execution and tool result', async () => {
    const executions: unknown[] = []
    const result = streamText({
      model: model(reported),
      prompt: 'lookup',
      tools: {
        lookup: tool({
          inputSchema: z.object({ query: z.string() }),
          execute: async (value) => {
            executions.push(value)
            return value
          }
        })
      }
    })
    const parts: TextStreamPart<ToolSet>[] = []
    for await (const part of result.fullStream) parts.push(part)
    expect(executions).toEqual([{ query: 'cherry' }])
    const call = parts.find((part) => part.type === 'tool-call')
    const resultPart = parts.find((part) => part.type === 'tool-result')
    expect(call).toBeDefined()
    expect(resultPart?.toolCallId).toBe(call?.toolCallId)
  })

  it('preserves text-only responses', async () => {
    const { parts, rejected } = await read([{ content: 'T' }], 'stop')
    expect(rejected).toBeUndefined()
    expect(parts.filter((part) => part.type.startsWith('tool-') || part.type === 'error')).toEqual([])
    expect(parts).toContainEqual({ type: 'text-delta', id: '0', delta: 'T' })
    expect(parts.find((part) => part.type === 'finish')).toMatchObject({
      finishReason: { unified: 'stop', raw: 'stop' }
    })
  })
})
