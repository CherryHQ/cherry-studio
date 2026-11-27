import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import type { LanguageModelV3CallOptions, LanguageModelV3FunctionTool, LanguageModelV3Message } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import type { Assistant } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { transformAnthropicCacheParams } from '../anthropicCache'
import {
  bedrockAnthropicCacheFeature,
  supportsBedrockOneHourCache,
  transformBedrockCacheParams
} from '../bedrockAnthropicCache'

function makeProvider(cacheControl?: Provider['settings']['cacheControl']): Provider {
  return { id: 'aws-bedrock', settings: cacheControl === undefined ? {} : { cacheControl } } as Provider
}

function makeModel(apiModelId: string): Model {
  return { id: `aws-bedrock::${apiModelId}`, apiModelId, name: apiModelId } as Model
}

function bedrockScope(apiModelId: string, provider = makeProvider(), aiSdkProviderId = 'bedrock') {
  return {
    aiSdkProviderId,
    endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
    provider,
    model: makeModel(apiModelId)
  } as never
}

const tool: LanguageModelV3FunctionTool = {
  type: 'function',
  name: 'lookup_account',
  description: 'Looks up an account.',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } } }
}

const longSystem: LanguageModelV3Message = { role: 'system', content: 'x '.repeat(3000) }
const user = (text: string): LanguageModelV3Message => ({ role: 'user', content: [{ type: 'text', text }] })
const assistant = (text: string): LanguageModelV3Message => ({ role: 'assistant', content: [{ type: 'text', text }] })
const toolCall: LanguageModelV3Message = {
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'lookup_account', input: { name: 'Acme' } }]
}
const toolResult: LanguageModelV3Message = {
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: 'call_1',
      toolName: 'lookup_account',
      output: { type: 'text', value: 'Acme: logistics, 1,200 employees.' }
    }
  ]
}

interface ConverseBlock {
  cachePoint?: { type: string; ttl?: string }
}

interface ConverseBody {
  system?: ConverseBlock[]
  messages?: { role: string; content: ConverseBlock[] }[]
  toolConfig?: { tools?: ConverseBlock[] }
}

async function captureConverseBody(params: LanguageModelV3CallOptions): Promise<ConverseBody> {
  let body = ''
  const model = createAmazonBedrock({
    region: 'us-east-1',
    accessKeyId: 'test',
    secretAccessKey: 'test',
    fetch: async (_url, init) => {
      body = String(init?.body)
      throw new Error('Captured request')
    }
  })('global.anthropic.claude-sonnet-4-6')
  await expect(model.doGenerate({ ...params, maxOutputTokens: 100 })).rejects.toThrow('Captured request')
  return JSON.parse(body) as ConverseBody
}

function cachePoints(body: ConverseBody): { position: string; cachePoint: ConverseBlock['cachePoint'] }[] {
  const points: { position: string; cachePoint: ConverseBlock['cachePoint'] }[] = []
  const inspect = (block: ConverseBlock, position: string) => {
    if (block.cachePoint) points.push({ position, cachePoint: block.cachePoint })
  }
  body.toolConfig?.tools?.forEach((block, i) => inspect(block, `tools.${i}`))
  body.system?.forEach((block, i) => inspect(block, `system.${i}`))
  body.messages?.forEach((message, i) =>
    message.content.forEach((block, j) => inspect(block, `messages.${i}.content.${j}`))
  )
  return points
}

async function bedrockBody(
  params: LanguageModelV3CallOptions,
  provider = makeProvider(),
  assistantConfig?: Assistant,
  supportsOneHourTtl = true
): Promise<ConverseBody> {
  const marked = await transformAnthropicCacheParams(params, provider, assistantConfig)
  return captureConverseBody(transformBedrockCacheParams(marked, supportsOneHourTtl))
}

describe('bedrockAnthropicCacheFeature.applies', () => {
  it.each([
    'global.anthropic.claude-sonnet-4-6',
    'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'anthropic.claude-opus-4-1-20250805-v1:0',
    'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6'
  ])('activates for Claude model id %s', (apiModelId) => {
    expect(bedrockAnthropicCacheFeature.applies!(bedrockScope(apiModelId))).toBe(true)
  })

  // Bedrock answers "You invoked an unsupported model or your request did not allow prompt caching"
  // when these models receive a cache point, which would break every chat with caching on.
  it.each([
    'meta.llama3-3-70b-instruct-v1:0',
    'mistral.ministral-3-8b-instruct',
    'qwen.qwen3-32b-v1:0',
    'openai.gpt-oss-20b',
    'amazon.nova-lite-v1:0',
    'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/a1b2c3d4e5f6'
  ])('stays off for model id %s, which may not accept cache points', (apiModelId) => {
    expect(bedrockAnthropicCacheFeature.applies!(bedrockScope(apiModelId))).toBe(false)
  })

  it.each([
    ['us.anthropic.claude-opus-4-1-20250805-v1:0', false],
    ['anthropic.claude-opus-4-1-20250805-v1:0', false],
    ['arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-opus-4-1-20250805-v1:0', false],
    ['global.anthropic.claude-opus-4-5-20251101-v1:0', true],
    ['global.anthropic.claude-sonnet-4-6', true],
    ['global.anthropic.claude-haiku-4-5-20251001-v1:0', true]
  ])('one-hour cache support for %s is %s', (apiModelId, expected) => {
    expect(supportsBedrockOneHourCache(makeModel(apiModelId))).toBe(expected)
  })

  it('respects an explicit cache opt-out', () => {
    const provider = makeProvider({ enabled: false, tokenThreshold: 1024 })

    expect(bedrockAnthropicCacheFeature.applies!(bedrockScope('global.anthropic.claude-sonnet-4-6', provider))).toBe(
      false
    )
  })

  it('leaves non-Bedrock Anthropic Messages providers to their own cache markers', () => {
    expect(bedrockAnthropicCacheFeature.applies!(bedrockScope('claude-sonnet-4-6', makeProvider(), 'anthropic'))).toBe(
      false
    )
  })
})

describe('Bedrock Converse request body', () => {
  const conversation = {
    prompt: [
      longSystem,
      user('Look up Acme.'),
      toolCall,
      toolResult,
      assistant('Acme is in logistics.'),
      user('Which industry?')
    ],
    tools: [tool]
  }

  it('sends no cache point at all when only Anthropic markers are present', async () => {
    const marked = await transformAnthropicCacheParams(conversation, makeProvider(), undefined)

    expect(cachePoints(await captureConverseBody(marked))).toEqual([])
  })

  it('turns the default system and last-two-message markers into Converse cache points', async () => {
    const points = cachePoints(await bedrockBody(conversation))

    expect(points.map((point) => point.position)).toEqual(['system.1', 'messages.3.content.1', 'messages.4.content.1'])
    expect(points.every((point) => point.cachePoint?.ttl === undefined)).toBe(true)
  })

  it('places the cache point after the tool result when an agent step ends on a tool result', async () => {
    const points = cachePoints(
      await bedrockBody({ prompt: [longSystem, user('Look up Acme.'), toolCall, toolResult], tools: [tool] })
    )

    expect(points.map((point) => point.position)).toEqual(['system.1', 'messages.1.content.1', 'messages.2.content.1'])
  })

  it('forwards the one-hour lifetime to every cache point when the provider asks for it', async () => {
    const points = cachePoints(
      await bedrockBody(conversation, makeProvider({ enabled: true, tokenThreshold: 1024, ttl: '1h' }))
    )

    expect(points).toHaveLength(3)
    expect(points.every((point) => point.cachePoint?.ttl === '1h')).toBe(true)
  })

  // AWS lists only five-minute caching for Claude Opus 4.1, so a one-hour `ttl` could be rejected there.
  it('keeps caching with the five-minute lifetime on models without one-hour support', async () => {
    const points = cachePoints(
      await bedrockBody(
        conversation,
        makeProvider({ enabled: true, tokenThreshold: 1024, ttl: '1h' }),
        undefined,
        false
      )
    )

    expect(points).toHaveLength(3)
    expect(points.every((point) => point.cachePoint?.ttl === undefined)).toBe(true)
  })

  it('never sends more than the four cache points Bedrock allows', async () => {
    const body = await bedrockBody(
      {
        prompt: [
          longSystem,
          user('u '.repeat(3000)),
          assistant('a '.repeat(3000)),
          user('u '.repeat(3000)),
          assistant('a '.repeat(3000)),
          user('u '.repeat(3000))
        ],
        tools: [{ ...tool, description: 'd '.repeat(3000) }]
      },
      makeProvider({ enabled: true, tokenThreshold: 1024, cacheLastNMessages: 6 })
    )

    expect(cachePoints(body).length).toBeLessThanOrEqual(4)
    expect(cachePoints(body).map((point) => point.position)).toContain('system.1')
  })

  it('adds no cache point for prompts with volatile time variables', async () => {
    const body = await bedrockBody(conversation, makeProvider(), {
      id: 'a1',
      prompt: 'Current time: {{time}}'
    } as Assistant)

    expect(cachePoints(body)).toEqual([])
  })

  // Caller hints the Anthropic adapter ignores must not add cache points, or the request
  // could exceed Bedrock's four-checkpoint limit and be rejected.
  it('only turns markers that count toward the four-breakpoint budget into cache points', async () => {
    const hint = { anthropic: { cacheControl: { type: 'ephemeral' } } }
    const prompt: LanguageModelV3Message[] = [
      longSystem,
      user('u '.repeat(3000)),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Searching.' },
          {
            type: 'tool-result',
            toolCallId: 'srv_1',
            toolName: 'web_search',
            output: { type: 'text', value: 'results', providerOptions: hint }
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'lookup_account',
            output: {
              type: 'content',
              value: [
                { type: 'text', text: 'first', providerOptions: { other: {} } },
                { type: 'text', text: 'second', providerOptions: hint }
              ]
            }
          }
        ]
      },
      user('u '.repeat(3000)),
      assistant('a '.repeat(3000)),
      user('u '.repeat(3000))
    ]
    const marked = await transformAnthropicCacheParams(
      { prompt },
      makeProvider({ enabled: true, tokenThreshold: 1024, cacheLastNMessages: 3 }),
      undefined
    )

    const withCachePoint = transformBedrockCacheParams(marked).prompt.filter(
      (message) => (message.providerOptions?.bedrock as { cachePoint?: unknown } | undefined)?.cachePoint
    )
    expect(withCachePoint).toHaveLength(4)
  })

  it('keeps the five-minute lifetime for a message that holds both lifetimes', async () => {
    const mixed: LanguageModelV3CallOptions = {
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'first',
              providerOptions: { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } }
            },
            { type: 'text', text: 'second', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
          ]
        }
      ]
    }

    expect(cachePoints(await captureConverseBody(transformBedrockCacheParams(mixed)))).toEqual([
      { position: 'messages.0.content.2', cachePoint: { type: 'default' } }
    ])
  })
})
