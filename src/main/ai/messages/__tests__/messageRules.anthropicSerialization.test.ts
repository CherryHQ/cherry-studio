// The oracle enforces the reported object-shape rule: this proves serialization/transport
// behaviour, not real Anthropic acceptance.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, type UIMessage } from 'ai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toModelMessages } from '../messageRules'

type WirePart = { type: string; id?: string; tool_use_id?: string; input?: unknown }
type WireBody = { messages: Array<{ role: string; content: WirePart[] }> }

const captures: Array<{ bytes: string; status: number }> = []
const server = createServer(async (request, response) => {
  let bytes = ''
  for await (const chunk of request) bytes += chunk.toString()
  const body: WireBody = JSON.parse(bytes)
  const invalid = body.messages
    .flatMap((message) => message.content)
    .some(
      (part) =>
        part.type === 'tool_use' && (part.input === null || typeof part.input !== 'object' || Array.isArray(part.input))
    )
  const status = invalid ? 400 : 200
  captures.push({ bytes, status })
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(
    JSON.stringify(
      invalid
        ? {
            type: 'error',
            error: { type: 'invalid_request_error', message: 'tool_use.input: Input should be an object' }
          }
        : {
            id: 'msg_oracle',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-5',
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 }
          }
    )
  )
})
let baseURL: string

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

const malformed = '{"query":'
const dynamicBad = {
  type: 'dynamic-tool',
  toolName: 'lookup',
  toolCallId: 'bad',
  state: 'output-error',
  input: malformed,
  errorText: 'Invalid arguments'
} as const
const staticBad = {
  type: 'tool-lookup',
  toolCallId: 'bad',
  state: 'output-error',
  rawInput: malformed,
  errorText: 'Invalid arguments'
} as const
const good = {
  type: 'dynamic-tool',
  toolName: 'lookup',
  toolCallId: 'good',
  state: 'output-available',
  input: { query: 'hello', options: { flags: [true, false] } },
  output: { found: true }
} as const

async function replay(parts: UIMessage['parts']) {
  const messages = await toModelMessages([
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'before' }] },
    { id: 'a1', role: 'assistant', parts },
    { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'after' }] }
  ])
  const result = await generateText({
    model: createAnthropic({ apiKey: 'dummy-key', baseURL })('claude-sonnet-4-5'),
    messages,
    maxRetries: 0
  })
  const capture = captures.at(-1)!
  expect(capture.status).toBe(200)
  expect(result.text).toBe('ok')
  const body: WireBody = JSON.parse(capture.bytes)
  const entries = body.messages.flatMap((message) => message.content)
  for (const part of entries.filter((part) => part.type === 'tool_use')) {
    expect(part.input).not.toBeNull()
    expect(typeof part.input).toBe('object')
    expect(Array.isArray(part.input)).toBe(false)
  }
  return entries.filter((part) => part.type === 'tool_use' || part.type === 'tool_result')
}

const successBytes =
  '[{"type":"tool_use","id":"good","name":"lookup","input":{"query":"hello","options":{"flags":[true,false]}}},{"type":"tool_result","tool_use_id":"good","content":"{\\"found\\":true}"}]'
const errorBytes =
  '[{"type":"tool_use","id":"error","name":"lookup","input":{}},{"type":"tool_result","tool_use_id":"error","content":"Lookup failed","is_error":true}]'

describe('Anthropic replay over loopback HTTP', () => {
  it.each([
    ['static', staticBad],
    ['dynamic', dynamicBad]
  ])('replays %s malformed history with HTTP 200 and removes both poisoned wire entries', async (_label, part) => {
    const entries = await replay([{ type: 'text', text: 'kept' }, part as UIMessage['parts'][number]])
    expect(entries).toEqual([])
    expect(entries.some((entry) => entry.id === 'bad' || entry.tool_use_id === 'bad')).toBe(false)
  })

  it('keeps the valid pair in a mixed history while dropping the malformed pair', async () => {
    expect(JSON.stringify(await replay([dynamicBad, good]))).toBe(successBytes)
  })

  it('preserves the normal success call/result serialized bytes', async () => {
    expect(JSON.stringify(await replay([good]))).toBe(successBytes)
  })

  it('preserves the object-valued error call/result serialized bytes', async () => {
    expect(
      JSON.stringify(
        await replay([
          {
            ...dynamicBad,
            toolCallId: 'error',
            input: {},
            errorText: 'Lookup failed'
          }
        ])
      )
    ).toBe(errorBytes)
  })
})
