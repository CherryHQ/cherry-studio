import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages'
import { jsonSchema, streamText, tool, wrapLanguageModel } from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      silly: vi.fn()
    })
  }
}))

import { collectFromFeatures } from '../../../../ai/runtime/aiSdk/params/collectFromFeatures'
import { INTERNAL_FEATURES } from '../../../../ai/runtime/aiSdk/params/features/internalFeatures'
import { AiSdkToAnthropicSse } from '../stream/AiSdkToAnthropicSse'

const DSML_CALL = [
  '<｜DSML｜tool_calls>',
  '<｜DSML｜invoke name="read_file">',
  '<｜DSML｜parameter name="path" string="true">/tmp/a.md</｜DSML｜parameter>',
  '</｜DSML｜invoke>',
  '</｜DSML｜tool_calls>'
].join('')

function createDsmlModel() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
        { type: 'stream-start', warnings: [] },
        { type: 'reasoning-start', id: 'reasoning-1' },
        { type: 'reasoning-delta', id: 'reasoning-1', delta: DSML_CALL },
        { type: 'reasoning-end', id: 'reasoning-1' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'end_turn' },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 0, reasoning: 1 }
          }
        }
      ])
    })
  })
}

async function createWrappedModel() {
  const features = INTERNAL_FEATURES.filter((feature) => feature.name === 'deepseek-dsml-parser')
  const contributions = collectFromFeatures(
    {
      model: {
        id: 'deepseek::deepseek-v4-flash',
        providerId: 'deepseek',
        apiModelId: 'deepseek-v4-flash'
      }
    } as never,
    features
  )
  expect(contributions.modelAdapters.map((plugin) => plugin.name)).toEqual(['deepseekDsmlParser'])

  const plugin = contributions.modelAdapters[0]
  const context = { middlewares: [] }
  await plugin.configureContext?.(context as never)
  return wrapLanguageModel({ model: createDsmlModel(), middleware: context.middlewares })
}

async function collectEvents(stream: ReadableStream<RawMessageStreamEvent>): Promise<RawMessageStreamEvent[]> {
  const events: RawMessageStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

describe('DeepSeek DSML through the Anthropic gateway', () => {
  it('keeps the internal parser feature gated to DeepSeek models', () => {
    const features = INTERNAL_FEATURES.filter((feature) => feature.name === 'deepseek-dsml-parser')
    const contributions = collectFromFeatures(
      { model: { id: 'openai::gpt-5', providerId: 'openai', apiModelId: 'gpt-5' } } as never,
      features
    )

    expect(contributions.modelAdapters).toEqual([])
  })

  it('projects a reasoning-channel DSML call as tool_use for gateway-routed Agent clients', async () => {
    const result = streamText({
      model: await createWrappedModel(),
      prompt: 'Read the file',
      tools: {
        read_file: tool({
          inputSchema: jsonSchema({
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
            additionalProperties: false
          })
        })
      }
    })
    const adapter = new AiSdkToAnthropicSse({ model: 'deepseek:deepseek-v4-flash' })
    const events = await collectEvents(adapter.transform(result.toUIMessageStream()))

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'content_block_start',
        content_block: expect.objectContaining({
          type: 'tool_use',
          name: 'read_file',
          input: {}
        })
      })
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"path":"/tmp/a.md"}' }
      })
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'message_delta',
        delta: expect.objectContaining({ stop_reason: 'tool_use' })
      })
    )
  })
})
