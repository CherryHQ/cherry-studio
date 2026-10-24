import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'

import { normalizeContext, type AssistantMessage, type Message, type Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { withPiToolResultReplay } from './piToolResultReplay'

interface WireMessage {
  role: string
  tool_call_id?: string
  content?: unknown
}

let server: Server
let model: Model<'openai-completions'>
let captures: { raw: string; status: number; messages: WireMessage[] }[]
const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

function call(calls: [string, string][]): AssistantMessage {
  return {
    role: 'assistant',
    content: calls.map(([id, name]) => ({ type: 'toolCall', id, name, arguments: {} })),
    api: 'openai-completions',
    provider: 'fixture',
    model: 'fixture',
    usage,
    stopReason: 'toolUse',
    timestamp: 1
  }
}

function output(toolCallId?: string, toolName = 'read'): Message {
  return {
    role: 'toolResult',
    ...(toolCallId === undefined ? {} : { toolCallId }),
    toolName,
    content: [{ type: 'text', text: 'REAL_OUTPUT_SENTINEL' }],
    isError: false,
    timestamp: 2
  } as Message
}

beforeEach(async () => {
  captures = []
  server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const { messages } = JSON.parse(raw) as { messages: WireMessage[] }
    const bad = messages.findIndex((message) => message.role === 'tool' && typeof message.tool_call_id !== 'string')
    const status = bad >= 0 ? 400 : 200
    captures.push({ raw, status, messages })
    if (bad >= 0) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({ error: { type: 'json_parse_error', message: `messages[${bad}]: missing field tool_call_id` } })
      )
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(
      `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  model = {
    id: 'fixture',
    name: 'fixture',
    api: 'openai-completions',
    provider: 'fixture',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100000,
    maxTokens: 1000
  }
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

async function run(messages: Message[], guarded: boolean) {
  const context = normalizeContext({ messages })
  const stream = guarded
    ? withPiToolResultReplay((model, context, options) =>
        streamSimple(model as Model<'openai-completions'>, context, options)
      )
    : streamSimple
  return stream(model, context, { apiKey: 'fixture' }).result()
}

async function artifact(name: string, assertions: Record<string, unknown>) {
  const directory = process.env.PI_REPLAY_ARTIFACT_DIR
  if (!directory) return
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, `${name}.json`), JSON.stringify({ captures, assertions }, null, 2))
}

describe('Pi tool result replay real serializer', () => {
  it('demonstrates the missing-field 400 and sends the repaired real output exactly once', async () => {
    const history = [call([['call_a', 'read']]), output()]
    const before = await run(history, false)
    expect(before.stopReason).toBe('error')
    expect(before.errorMessage).toContain('400')
    expect(before.errorMessage).toContain('missing field tool_call_id')
    const malformed = captures[0].messages.filter((message) => message.role === 'tool')
    expect(malformed).toHaveLength(2)
    expect(malformed[0]).not.toHaveProperty('tool_call_id')
    expect(malformed[0].content).toContain('REAL_OUTPUT_SENTINEL')
    expect(malformed[1]).toMatchObject({ tool_call_id: 'call_a', content: 'No result provided' })
    const after = await run(history, true)
    expect(after.stopReason).toBe('stop')
    expect(captures.map(({ status }) => status)).toEqual([400, 200])
    expect(captures[1].messages.filter((message) => message.role === 'tool')).toEqual([
      { role: 'tool', tool_call_id: 'call_a', content: 'REAL_OUTPUT_SENTINEL' }
    ])
    await artifact('unique-before-after', {
      beforeStop: before.stopReason,
      afterStop: after.stopReason,
      realOutputExactlyOnce: true
    })
  })

  it('drops ambiguous output and lets pi supply correctly identified synthetic answers', async () => {
    const history = [
      call([
        ['call_a', 'read'],
        ['call_b', 'read']
      ]),
      output()
    ]
    const before = await run(history, false)
    const after = await run(history, true)
    expect(before.stopReason).toBe('error')
    expect(after.stopReason).toBe('stop')
    expect(captures[1].raw).not.toContain('REAL_OUTPUT_SENTINEL')
    expect(captures[1].messages.filter((message) => message.role === 'tool')).toEqual([
      { role: 'tool', tool_call_id: 'call_a', content: 'No result provided' },
      { role: 'tool', tool_call_id: 'call_b', content: 'No result provided' }
    ])
    await artifact('ambiguous-before-after', {
      beforeStop: before.stopReason,
      afterStop: after.stopReason,
      anonymousOutputAbsent: true
    })
  })

  it.each(['text', 'image-downgrade', 'vision-image', 'parallel-reversed', 'matched-empty', 'system-on', 'system-off'])(
    'preserves valid %s history byte for byte',
    async (scenario) => {
      let history: Message[] = [{ role: 'user', content: 'hello', timestamp: 0 }]
      if (scenario === 'parallel-reversed') {
        history = [
          call([
            ['call_a', 'read'],
            ['call_b', 'write']
          ]),
          output('call_b', 'write'),
          output('call_a')
        ]
      } else if (scenario === 'matched-empty') {
        history = [call([['', 'read']]), output('')]
      } else if (scenario.startsWith('system-')) {
        model.compat = { supportsMidConvoSystemMessages: scenario === 'system-on' }
        history = [call([['call_a', 'read']]), { role: 'system', content: 'MID_TURN', timestamp: 2 }, output('call_a')]
      } else if (scenario.includes('image')) {
        if (scenario === 'vision-image') model.input = ['text', 'image']
        history = [
          call([['call_a', 'read']]),
          {
            ...output('call_a'),
            content: [
              { type: 'text', text: 'REAL_OUTPUT_SENTINEL' },
              { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
            ]
          } as Message
        ]
      }
      const before = await run(history, false)
      const after = await run(history, true)
      expect(before.stopReason).toBe('stop')
      expect(after.stopReason).toBe('stop')
      expect(captures.map(({ status }) => status)).toEqual([200, 200])
      expect(captures[1].raw).toBe(captures[0].raw)
      await artifact(`valid-${scenario}`, {
        beforeStop: before.stopReason,
        afterStop: after.stopReason,
        byteIdentical: true
      })
    }
  )
})
