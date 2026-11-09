import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { crc32 } from 'node:zlib'

import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { type LanguageModelV3CallOptions, type LanguageModelV3StreamPart, TypeValidationError } from '@ai-sdk/provider'
import { jsonSchema, streamText, tool } from 'ai'
import { describe, expect, it } from 'vitest'

const { createAmazonBedrock: createCjsBedrock } = createRequire(import.meta.url)('@ai-sdk/amazon-bedrock') as {
  createAmazonBedrock: typeof createAmazonBedrock
}
const toolUseId = 'tooluse_L1OARlcq1CTp9pa6DYCmdV'
const prompt: LanguageModelV3CallOptions['prompt'] = [
  { role: 'user', content: [{ type: 'text', text: 'Read the file' }] }
]
const inputSchema = jsonSchema<{ path: string }>({
  type: 'object',
  properties: { path: { type: 'string' } },
  required: ['path'],
  additionalProperties: false
})

function frame(eventType: string, payload: unknown) {
  const headers = Buffer.concat(
    Object.entries({
      ':message-type': 'event',
      ':event-type': eventType,
      ':content-type': 'application/json'
    }).map(([name, value]) => {
      const key = Buffer.from(name)
      const val = Buffer.from(value)
      const header = Buffer.alloc(1 + key.length + 1 + 2 + val.length)
      header[0] = key.length
      key.copy(header, 1)
      header[1 + key.length] = 7
      header.writeUInt16BE(val.length, key.length + 2)
      val.copy(header, key.length + 4)
      return header
    })
  )
  const body = Buffer.from(JSON.stringify(payload))
  const out = Buffer.alloc(16 + headers.length + body.length)
  out.writeUInt32BE(out.length, 0)
  out.writeUInt32BE(headers.length, 4)
  out.writeUInt32BE(crc32(out.subarray(0, 8)), 8)
  headers.copy(out, 12)
  body.copy(out, 12 + headers.length)
  out.writeUInt32BE(crc32(out.subarray(0, -4)), out.length - 4)
  return out
}

function events(toolUse: Record<string, unknown>, firstInput: string | number = '{"path":'): [string, unknown][] {
  return [
    ['messageStart', { role: 'assistant' }],
    ['contentBlockStart', { contentBlockIndex: 2, start: { toolUse } }],
    ['contentBlockDelta', { contentBlockIndex: 2, delta: { toolUse: { input: firstInput } } }],
    ['contentBlockDelta', { contentBlockIndex: 2, delta: { toolUse: { input: '"/tmp/example.txt"}' } } }],
    ['contentBlockStop', { contentBlockIndex: 2 }],
    ['messageStop', { stopReason: 'tool_use' }],
    ['metadata', { usage: { inputTokens: 12, outputTokens: 6 } }]
  ]
}

function makeModel(factory: typeof createAmazonBedrock, sequence: [string, unknown][]) {
  const bytes = Buffer.concat(sequence.map(([eventType, payload]) => frame(eventType, payload)))
  return factory({
    region: 'us-east-1',
    apiKey: 'test-key',
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let offset = 0; offset < bytes.length; offset += 37)
              controller.enqueue(bytes.subarray(offset, offset + 37))
            controller.close()
          }
        }),
        { headers: { 'content-type': 'application/vnd.amazon.eventstream' } }
      )
  })('global.anthropic.claude-sonnet-4-6')
}

async function streamEvents(factory: typeof createAmazonBedrock, sequence: [string, unknown][]) {
  const { stream } = await makeModel(factory, sequence).doStream({
    prompt,
    tools: [{ type: 'function', name: 'read_file', inputSchema: await inputSchema.jsonSchema }]
  })
  const parts: LanguageModelV3StreamPart[] = []
  for await (const part of stream) parts.push(part)
  return parts
}

describe('patched @ai-sdk/amazon-bedrock tool-use input', () => {
  describe.each([
    ['ESM', createAmazonBedrock],
    ['CJS', createCjsBedrock]
  ] as const)('%s bundle', (_bundle, factory) => {
    it.each([false, true])('assembles tool arguments with start input present: %s', async (includeInput) => {
      const parts = await streamEvents(
        factory,
        events({ name: 'read_file', toolUseId, ...(includeInput ? { input: {} } : {}) })
      )

      expect(parts.filter((part) => part.type === 'error')).toEqual([])
      const calls = parts.filter((part) => part.type === 'tool-call')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ toolCallId: toolUseId, toolName: 'read_file' })
      expect(JSON.parse(calls[0].input)).toEqual({ path: '/tmp/example.txt' })
      expect(parts.filter((part) => part.type === 'tool-input-start')).toEqual([
        { type: 'tool-input-start', id: toolUseId, toolName: 'read_file' }
      ])
      expect(parts.filter((part) => part.type === 'tool-input-delta')).toEqual([
        { type: 'tool-input-delta', id: toolUseId, delta: '{"path":' },
        { type: 'tool-input-delta', id: toolUseId, delta: '"/tmp/example.txt"}' }
      ])
      expect(parts.filter((part) => part.type === 'tool-input-end')).toEqual([
        { type: 'tool-input-end', id: toolUseId }
      ])
      expect(parts).toContainEqual(
        expect.objectContaining({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' } })
      )
    })
  })

  it('executes a tool exactly once with the assembled arguments when start input is absent', async () => {
    const executed: { path: string }[] = []
    const result = streamText({
      model: makeModel(createAmazonBedrock, events({ name: 'read_file', toolUseId })),
      prompt: 'Read the file',
      onError: () => {},
      tools: {
        read_file: tool({
          inputSchema,
          execute: async (input) => {
            executed.push(input)
            return `contents of ${input.path}`
          }
        })
      }
    })
    const parts = await Array.fromAsync(result.fullStream)

    expect(parts.filter((part) => part.type === 'error')).toEqual([])
    expect(executed).toEqual([{ path: '/tmp/example.txt' }])
    expect(parts.filter((part) => part.type === 'tool-result')).toEqual([
      expect.objectContaining({
        toolCallId: toolUseId,
        toolName: 'read_file',
        input: { path: '/tmp/example.txt' },
        output: 'contents of /tmp/example.txt'
      })
    ])
    expect(parts).toContainEqual(expect.objectContaining({ type: 'finish', finishReason: 'tool-calls' }))
  })

  it.each(['name', 'toolUseId'])('rejects a start also missing %s with a classified diagnostic', async (field) => {
    const toolUse: Record<string, unknown> = { name: 'read_file', toolUseId }
    delete toolUse[field]
    const parts = await streamEvents(createAmazonBedrock, events(toolUse))
    const error = parts.find((part) => part.type === 'error')?.error

    expect(TypeValidationError.isInstance(error)).toBe(true)
    expect((error as TypeValidationError).value).toEqual({
      contentBlockStart: { contentBlockIndex: 2, start: { toolUse } }
    })
    expect(error).toMatchObject({
      cause: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_type',
            expected: 'string',
            path: ['contentBlockStart', 'start', 'toolUse', field],
            message: 'Invalid input: expected string, received undefined'
          })
        ])
      }
    })
    expect(parts.filter((part) => part.type === 'tool-call')).toEqual([])
  })

  it('rejects a numeric input delta with a classified string diagnostic', async () => {
    const parts = await streamEvents(createAmazonBedrock, events({ name: 'read_file', toolUseId, input: {} }, 42))
    const error = parts.find((part) => part.type === 'error')?.error

    expect(TypeValidationError.isInstance(error)).toBe(true)
    expect((error as TypeValidationError).value).toEqual({
      contentBlockDelta: { contentBlockIndex: 2, delta: { toolUse: { input: 42 } } }
    })
    expect(error).toMatchObject({
      cause: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_union',
            path: ['contentBlockDelta', 'delta'],
            errors: expect.arrayContaining([
              expect.arrayContaining([
                expect.objectContaining({
                  code: 'invalid_type',
                  expected: 'string',
                  path: ['toolUse', 'input'],
                  message: 'Invalid input: expected string, received number'
                })
              ])
            ])
          })
        ])
      }
    })
  })
})
