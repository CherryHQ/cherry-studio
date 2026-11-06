import { createAnthropic } from '@ai-sdk/anthropic'
import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3Message,
  LanguageModelV3ToolResultOutput
} from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import type { Assistant } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { anthropicCacheFeature, deriveEmittedCacheSlots, transformAnthropicCacheParams } from '../anthropicCache'
import { createQwenAnthropicWebToolsMiddleware } from '../qwenAnthropicWebTools'

function makeProvider(cacheControl?: Provider['settings']['cacheControl']): Provider {
  return { id: 'anthropic', settings: cacheControl === undefined ? {} : { cacheControl } } as Provider
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return { id: 'anthropic::claude-sonnet-4', name: 'Claude Sonnet 4', ...overrides } as Model
}

function textMessage(role: 'system' | 'user' | 'assistant', text: string): LanguageModelV3Message {
  if (role === 'system') return { role, content: text }
  return { role, content: [{ type: 'text', text }] }
}

function makeTool(name: string, descriptionChars = 10): LanguageModelV3FunctionTool {
  return {
    type: 'function',
    name,
    description: 'd'.repeat(descriptionChars),
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'x'.repeat(descriptionChars) }
      }
    }
  }
}

function hasCacheControl(value: unknown): boolean {
  return Boolean(getCacheControl(value))
}

function getCacheControl(value: unknown): unknown {
  const options = (
    (value as { providerOptions?: unknown }).providerOptions as
      | { anthropic?: { cacheControl?: unknown; cache_control?: unknown } }
      | undefined
  )?.anthropic
  return options?.cacheControl ?? options?.cache_control
}

function collectCacheControls(params: LanguageModelV3CallOptions): unknown[] {
  const controls: unknown[] = []
  for (const tool of params.tools ?? []) {
    if ('providerOptions' in tool && hasCacheControl(tool)) controls.push(getCacheControl(tool))
  }
  for (const message of params.prompt) {
    if (hasCacheControl(message)) controls.push(getCacheControl(message))
    if (typeof message.content !== 'string') {
      for (const part of message.content) {
        if ('providerOptions' in part && hasCacheControl(part)) controls.push(getCacheControl(part))
        if (part.type === 'tool-result') {
          if (hasCacheControl(part.output)) controls.push(getCacheControl(part.output))
          if (part.output.type === 'content')
            for (const item of part.output.value) if (hasCacheControl(item)) controls.push(getCacheControl(item))
        }
      }
    }
  }
  return controls
}

function countCacheMarkers(params: LanguageModelV3CallOptions): number {
  return collectCacheControls(params).length
}

async function transform(
  input: Partial<LanguageModelV3CallOptions>,
  provider = makeProvider(),
  assistant?: Assistant
): Promise<LanguageModelV3CallOptions> {
  return transformAnthropicCacheParams(
    {
      prompt: [textMessage('system', 'system'), textMessage('user', 'hello')],
      ...input
    },
    provider,
    assistant
  )
}

interface SerializedBlock {
  cache_control?: { type: string; ttl?: string }
  tool_use_id?: string
}

interface SerializedBody {
  tools?: SerializedBlock[]
  system?: SerializedBlock[]
  messages?: { content: SerializedBlock[] }[]
}

async function captureBody(params: LanguageModelV3CallOptions): Promise<string> {
  let body = ''
  const model = createAnthropic({
    apiKey: 'test',
    baseURL: 'http://localhost/v1',
    fetch: async (_url, init) => {
      body = String(init?.body)
      throw new Error('Captured request')
    }
  })('claude-sonnet-4-5')
  await expect(model.doGenerate({ ...params, maxOutputTokens: 100 })).rejects.toThrow('Captured request')
  return body
}

function extractBodyMarkers(body: SerializedBody): { position: string; ttl: string }[] {
  const markers: { position: string; ttl: string }[] = []
  const inspect = (block: SerializedBlock, position: string) => {
    if (block.cache_control) markers.push({ position, ttl: block.cache_control.ttl ?? '5m' })
  }
  body.tools?.forEach((block, i) => inspect(block, `tools.${i}`))
  body.system?.forEach((block, i) => inspect(block, `system.${i}`))
  body.messages?.forEach((message, i) =>
    message.content.forEach((block, j) => inspect(block, `messages.${i}.content.${j}`))
  )
  return markers
}

describe('anthropicCacheFeature', () => {
  it('activates by default for Anthropic Messages endpoints', () => {
    expect(
      anthropicCacheFeature.applies!({
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        provider: makeProvider(),
        model: makeModel()
      } as never)
    ).toBe(true)
  })

  it('respects explicit opt-out', () => {
    expect(
      anthropicCacheFeature.applies!({
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        provider: makeProvider({ enabled: false, tokenThreshold: 1024 }),
        model: makeModel()
      } as never)
    ).toBe(false)
  })

  it('keeps migrated v1 threshold-zero providers disabled', () => {
    expect(
      anthropicCacheFeature.applies!({
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        provider: makeProvider({ enabled: true, tokenThreshold: 0 }),
        model: makeModel()
      } as never)
    ).toBe(false)
  })
})

describe('transformAnthropicCacheParams', () => {
  it('does not emit markers when explicitly disabled', async () => {
    const out = await transform(
      { prompt: [textMessage('system', 'x '.repeat(3000))] },
      makeProvider({ enabled: false, tokenThreshold: 1024 })
    )

    expect(countCacheMarkers(out)).toBe(0)
  })

  it('does not emit markers for migrated v1 threshold-zero providers', async () => {
    const out = await transform(
      {
        prompt: [textMessage('system', 'x '.repeat(3000)), textMessage('user', 'u '.repeat(3000))],
        tools: [makeTool('mcp_tool', 6000)]
      },
      makeProvider({ enabled: true, tokenThreshold: 0 })
    )

    expect(countCacheMarkers(out)).toBe(0)
  })

  it('does not emit markers below the configured prefix threshold', async () => {
    const out = await transform({ prompt: [textMessage('system', 'short')] })

    expect(countCacheMarkers(out)).toBe(0)
  })

  it('uses the configured marker threshold without local model-specific guesses', async () => {
    const out = await transform(
      { prompt: [textMessage('system', 'x '.repeat(1500))] },
      makeProvider({ enabled: true, tokenThreshold: 1024 })
    )

    expect(countCacheMarkers(out)).toBe(1)
  })

  it('uses the configured one-hour lifetime for every emitted cache breakpoint', async () => {
    const out = await transform(
      {
        prompt: [textMessage('system', 'x '.repeat(3000)), textMessage('user', 'u '.repeat(3000))],
        tools: [makeTool('mcp_tool', 6000)]
      },
      makeProvider({ enabled: true, tokenThreshold: 1024, cacheLastNMessages: 1, ttl: '1h' })
    )

    expect(collectCacheControls(out)).toEqual([
      { type: 'ephemeral', ttl: '1h' },
      { type: 'ephemeral', ttl: '1h' },
      { type: 'ephemeral', ttl: '1h' }
    ])
  })

  it('preserves the implicit five-minute cache marker by default', async () => {
    const out = await transform({ prompt: [textMessage('system', 'x '.repeat(3000))] })

    expect(collectCacheControls(out)).toEqual([{ type: 'ephemeral' }])
  })

  it('uses tool definitions in the cumulative prefix gate for system messages', async () => {
    const out = await transform({
      tools: [makeTool('mcp_tool', 6000)],
      prompt: [textMessage('system', 'short')]
    })

    expect(hasCacheControl(out.prompt[0])).toBe(true)
    expect(out.tools?.filter((tool) => 'providerOptions' in tool && hasCacheControl(tool))).toHaveLength(1)
  })

  it('keeps marker count under Anthropic’s four-breakpoint ceiling when more than four candidates qualify', async () => {
    const out = await transform(
      {
        prompt: [
          textMessage('system', 'x '.repeat(3000)),
          textMessage('user', 'u '.repeat(3000)),
          textMessage('assistant', 'a '.repeat(3000)),
          textMessage('user', 'u '.repeat(3000)),
          textMessage('assistant', 'a '.repeat(3000)),
          textMessage('user', 'u '.repeat(3000))
        ],
        tools: [makeTool('z_tool', 5000), makeTool('a_tool', 5000)]
      },
      makeProvider({ enabled: true, tokenThreshold: 1024, cacheLastNMessages: 6 })
    )

    expect(countCacheMarkers(out)).toBe(4)
    expect(hasCacheControl(out.prompt[0])).toBe(true)
    expect(out.tools?.filter((tool) => 'providerOptions' in tool && hasCacheControl(tool))).toHaveLength(1)
    expect(countCacheMarkers({ ...out, tools: undefined, prompt: out.prompt.slice(1) })).toBe(2)
  })

  it('sorts inline tools and marks exactly one deterministic tool definition when tool schemas cross the threshold', async () => {
    const out = await transform({
      tools: [makeTool('z_tool', 6000), makeTool('a_tool', 6000)],
      prompt: [textMessage('system', 'short')]
    })

    expect(out.tools?.map((tool) => tool.name)).toEqual(['a_tool', 'z_tool'])
    expect(out.tools?.filter((tool) => 'providerOptions' in tool && hasCacheControl(tool))).toHaveLength(1)
    expect(hasCacheControl(out.tools?.at(-1) as LanguageModelV3FunctionTool)).toBe(true)
  })

  it('serializes the same selected tool set identically regardless of input order', async () => {
    const first = await transform({
      tools: [makeTool('z_tool', 2000), makeTool('a_tool', 2000)],
      prompt: [textMessage('system', 'short')]
    })
    const second = await transform({
      tools: [makeTool('a_tool', 2000), makeTool('z_tool', 2000)],
      prompt: [textMessage('system', 'short')]
    })

    expect(JSON.stringify(first.tools)).toBe(JSON.stringify(second.tools))
  })

  it('counts tool-result payloads when deciding trailing cache breakpoints', async () => {
    const out = await transform({
      prompt: [
        textMessage('system', 'short'),
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'large_mcp_tool',
              output: { type: 'text', value: 'tool output '.repeat(3000) }
            }
          ]
        }
      ]
    })

    expect(deriveEmittedCacheSlots(out)).toBeDefined()
    expect(extractBodyMarkers(JSON.parse(await captureBody(out)))).toEqual([
      { position: 'messages.0.content.0', ttl: '5m' }
    ])
    const below = await transform({
      prompt: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'large_mcp_tool',
              output: { type: 'text', value: 'small' }
            }
          ]
        }
      ]
    })
    expect(deriveEmittedCacheSlots(below)).toBeDefined()
    expect(extractBodyMarkers(JSON.parse(await captureBody(below)))).toEqual([])
  })

  it('skips system and trailing markers for volatile time prompts but keeps stable tool markers', async () => {
    const out = await transform(
      {
        prompt: [
          textMessage('system', 'x '.repeat(3000)),
          textMessage('user', 'u '.repeat(3000)),
          textMessage('assistant', 'a '.repeat(3000))
        ],
        tools: [makeTool('mcp_tool', 6000)]
      },
      makeProvider({ enabled: true, tokenThreshold: 1024, cacheLastNMessages: 2 }),
      { id: 'a1', prompt: 'Current time: {{time}}' } as Assistant
    )

    expect(hasCacheControl(out.prompt[0])).toBe(false)
    expect(out.tools?.filter((tool) => 'providerOptions' in tool && hasCacheControl(tool))).toHaveLength(1)
    expect(countCacheMarkers({ ...out, tools: undefined })).toBe(0)
  })
})

describe('overflow cleanup', () => {
  const mark = { anthropic: { cache_control: { type: 'ephemeral', ttl: '1h' } } }
  const provider = makeProvider({ enabled: true, tokenThreshold: 1, cacheLastNMessages: 2 })
  const part = (message: LanguageModelV3Message) => (message.content as { providerOptions?: unknown }[])[0]

  it.each([1, 3, 4])('preserves four selected targets with %i incoming hints', async (count) => {
    const tools = [
      makeTool('zeta', 100),
      ...Array.from({ length: count }, (_, i) => ({ ...makeTool(`a${i}`), providerOptions: mark }))
    ]
    const input = {
      tools,
      prompt: [textMessage('system', 'system'), textMessage('user', 'first'), textMessage('assistant', 'second')]
    }
    const before = structuredClone(input)
    const out = await transform(input, provider)
    expect(countCacheMarkers(out)).toBe(4)
    expect(out.tools?.filter(hasCacheControl).map((tool) => tool.name)).toEqual(['zeta'])
    expect(hasCacheControl(out.prompt[0])).toBe(true)
    expect(hasCacheControl(part(out.prompt[1]))).toBe(true)
    expect(hasCacheControl(part(out.prompt[2]))).toBe(true)
    expect(input).toEqual(before)
  })

  it.each(['holder', 'item'])('counts tool result output %s hints', async (kind) => {
    const output =
      kind === 'holder'
        ? { type: 'text', value: 'result', providerOptions: mark }
        : { type: 'content', value: [{ type: 'text', text: 'result', providerOptions: mark }] }
    const out = await transform(
      {
        tools: [makeTool('zeta', 100)],
        prompt: [
          textMessage('system', 'system'),
          {
            role: 'tool',
            content: [{ type: 'tool-result', toolCallId: '1', toolName: 'x', output }]
          } as LanguageModelV3Message,
          textMessage('user', 'one'),
          textMessage('user', 'two')
        ]
      },
      provider
    )
    expect(countCacheMarkers(out)).toBe(4)
    expect(hasCacheControl(out.tools![0])).toBe(true)
    expect(hasCacheControl(part(out.prompt[2]))).toBe(true)
    expect(hasCacheControl(part(out.prompt[3]))).toBe(true)
  })

  it('retains sorted tools then prompt positions, removing both aliases', async () => {
    const dual = {
      anthropic: { cacheControl: { type: 'ephemeral' }, cache_control: { type: 'ephemeral' }, extra: 'keep' },
      other: { x: 1 }
    }
    const input = {
      tools: ['z', 'a'].map((name) => ({ ...makeTool(name), providerOptions: mark })),
      prompt: Array.from({ length: 3 }, (_, i) => ({
        ...textMessage('system', String(i)),
        providerOptions: i === 2 ? dual : mark
      }))
    }
    const before = structuredClone(input)
    const out = await transform(input, makeProvider({ enabled: true, tokenThreshold: 999999 }))
    expect(countCacheMarkers(out)).toBe(4)
    expect(out.tools?.filter(hasCacheControl).map((t) => t.name)).toEqual(['a', 'z'])
    expect(out.prompt.map(hasCacheControl)).toEqual([true, true, false])
    expect(out.prompt[2].providerOptions).toEqual({ anthropic: { extra: 'keep' }, other: { x: 1 } })
    expect(input).toEqual(before)
  })

  it('cleans empty prompts without reordering tools', async () => {
    const tools = ['e', 'd', 'c', 'b', 'a'].map((name) => ({ ...makeTool(name), providerOptions: mark }))
    const out = await transform({ prompt: [], tools }, provider)
    expect(out.tools?.map((t) => t.name)).toEqual(['e', 'd', 'c', 'b', 'a'])
    expect(out.tools?.filter(hasCacheControl).map((t) => t.name)).toEqual(['e', 'd', 'c', 'b'])
  })

  it('replaces the TTL of an already selected target and leaves exactly four holders unchanged otherwise', async () => {
    const input = {
      tools: [{ ...makeTool('zeta', 100), providerOptions: mark }],
      prompt: [textMessage('system', 'system'), textMessage('user', 'one'), textMessage('user', 'two')]
    }
    const out = await transform(input, provider)
    expect(countCacheMarkers(out)).toBe(4)
    expect(getCacheControl(out.tools![0])).toEqual({ type: 'ephemeral' })
    expect((out.tools![0] as LanguageModelV3FunctionTool).providerOptions).toEqual({
      anthropic: { ...mark.anthropic, cacheControl: { type: 'ephemeral' } }
    })
  })

  it.each([
    { enabled: false, tokenThreshold: 1 },
    { enabled: true, tokenThreshold: 0 }
  ])('returns disabled inputs untouched', async (settings) => {
    const input = {
      prompt: [],
      tools: Array.from({ length: 5 }, (_, i) => ({ ...makeTool(String(i)), providerOptions: mark }))
    }
    expect(await transformAnthropicCacheParams(input, makeProvider(settings), undefined)).toBe(input)
  })

  it.each(['volatile', 'system disabled'])('respects %s placement gate during overflow', async (gate) => {
    const tools = Array.from({ length: 5 }, (_, i) => ({ ...makeTool(String(i), 100), providerOptions: mark }))
    const out = await transform(
      { tools, prompt: [textMessage('system', 'system'), textMessage('user', 'user')] },
      makeProvider({ enabled: true, tokenThreshold: 1, cacheSystemMessage: gate !== 'system disabled' }),
      gate === 'volatile' ? ({ prompt: '{{time}}' } as Assistant) : undefined
    )
    expect(countCacheMarkers(out)).toBe(4)
    expect(hasCacheControl(out.prompt[0])).toBe(false)
    expect(hasCacheControl(out.tools!.at(-1)!)).toBe(true)
  })

  it('counts shared holders by position and preserves schemas, signatures and unrelated options', async () => {
    const options = {
      anthropic: { cacheControl: { type: 'ephemeral' }, cache_control: { type: 'ephemeral' }, signature: 'signed' },
      other: { keep: true }
    }
    const shared = { type: 'reasoning', text: 'thought', providerOptions: options }
    const tools = [makeTool('zeta', 100)]
    const input = {
      tools,
      prompt: [
        textMessage('system', 'system'),
        { role: 'assistant', content: [shared, shared, shared, shared, shared] },
        textMessage('user', 'one'),
        textMessage('user', 'two')
      ]
    } as LanguageModelV3CallOptions
    const before = structuredClone(input)
    const out = await transform(input, provider)
    expect(countCacheMarkers(out)).toBe(4)
    expect((out.tools![0] as LanguageModelV3FunctionTool).inputSchema).toEqual(tools[0].inputSchema)
    const parts = out.prompt[1].content as (typeof shared)[]
    expect(parts.map(hasCacheControl)).toEqual([false, false, false, false, false])
    expect(parts.map((p) => p.providerOptions)).toEqual(
      Array(5).fill({ anthropic: { signature: 'signed' }, other: { keep: true } })
    )
    expect(input).toEqual(before)
  })

  it('preserves an already marked selection through overflow and replaces its TTL', async () => {
    const input = {
      tools: [
        { ...makeTool('a'), providerOptions: mark },
        { ...makeTool('zeta', 100), providerOptions: mark }
      ],
      prompt: [textMessage('system', 'system'), textMessage('user', 'one'), textMessage('user', 'two')]
    }
    const out = await transform(input, provider)
    expect(countCacheMarkers(out)).toBe(4)
    expect(out.tools?.filter(hasCacheControl).map((t) => t.name)).toEqual(['zeta'])
    expect(getCacheControl(out.tools![1])).toEqual({ type: 'ephemeral' })
  })
})

describe('serialized adapter cache markers', () => {
  const longMark = { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } }
  const shortMark = { anthropic: { cacheControl: { type: 'ephemeral' } } }
  const provider = makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 2 })

  it.each([
    ['short then long', false, [{ position: 'tools.0', ttl: '5m' }]],
    [
      'long then short',
      true,
      [
        { position: 'tools.0', ttl: '1h' },
        { position: 'tools.1', ttl: '5m' }
      ]
    ]
  ])('retains empty-prompt tools in emitted order: %s', async (_name, longFirst, expected) => {
    const tools = [
      { ...makeTool('z'), providerOptions: longFirst ? longMark : shortMark },
      { ...makeTool('a'), providerOptions: longFirst ? shortMark : longMark }
    ]
    const out = await transform({ prompt: [], tools }, makeProvider({ enabled: true, cacheLastNMessages: 0 }))
    const body = JSON.parse(await captureBody(out))
    expect(out.tools?.map((tool) => tool.name)).toEqual(['z', 'a'])
    expect(extractBodyMarkers(body)).toEqual(expected)
    expect(body.tools.map((tool: { name: string }) => tool.name)).toEqual(['z', 'a'])
  })

  it('clears dead file hints before retaining a later text marker', async () => {
    const input: LanguageModelV3CallOptions = {
      prompt: [
        {
          role: 'assistant',
          content: [
            { type: 'file', mediaType: 'image/png', data: new Uint8Array([1]), providerOptions: shortMark },
            { type: 'text', text: 'answer', providerOptions: longMark }
          ]
        }
      ]
    }
    const out = await transform(input, makeProvider({ enabled: true, cacheLastNMessages: 0 }))
    expect(extractBodyMarkers(JSON.parse(await captureBody(out)))).toEqual([
      { position: 'messages.0.content.0', ttl: '1h' }
    ])
    expect(hasCacheControl((out.prompt[0].content as object[])[0])).toBe(false)
    expect(hasCacheControl((input.prompt[0].content as object[])[0])).toBe(true)
  })

  it('does not let dead reasoning lookups suppress a selected tool', async () => {
    const input: LanguageModelV3CallOptions = {
      tools: [makeTool('selected', 6000)],
      prompt: [
        {
          role: 'assistant',
          content: Array.from({ length: 4 }, (_, i) => ({
            type: 'reasoning' as const,
            text: `thought ${i}`,
            providerOptions: { anthropic: { signature: 'signed', cacheControl: { type: 'ephemeral' } } }
          }))
        }
      ]
    }
    const out = await transform(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 0 })
    )
    const body = JSON.parse(await captureBody(out))
    expect(extractBodyMarkers(body)).toEqual([{ position: 'tools.0', ttl: '5m' }])
    expect(body.messages[0].content.map((block: { type: string }) => block.type)).toEqual(Array(4).fill('thinking'))
    expect((out.prompt[0].content as object[]).every((part) => !hasCacheControl(part))).toBe(true)
  })

  it('preserves excluded toolset requests after placement', async () => {
    const input: LanguageModelV3CallOptions = {
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'computer',
              toolName: 'desk',
              input: { action: 'screenshot' },
              providerOptions: longMark
            }
          ]
        }
      ],
      tools: [{ type: 'provider', id: 'anthropic.computer_toolset_20260801', name: 'desk', args: {} }]
    }
    expect(deriveEmittedCacheSlots(input)).toBeUndefined()
    const out = await transformAnthropicCacheParams(
      input,
      makeProvider({ enabled: true, cacheLastNMessages: 0, cacheSystemMessage: false }),
      undefined
    )
    expect(out).toBe(input)
    const body = JSON.parse(await captureBody(out))
    expect(body.messages[0].content[0]).toMatchObject({
      type: 'tool_use',
      name: 'screenshot',
      toolset_name: 'computer',
      cache_control: { ttl: '1h' }
    })
    expect(extractBodyMarkers(body)).toEqual([{ position: 'messages.0.content.0', ttl: '1h' }])
  })

  it.each([
    ['unsigned', {}, [{ position: 'messages.1.content.0', ttl: '5m' }], ['text', 'tool_use']],
    [
      'signed',
      { signature: '' },
      [
        { position: 'messages.1.content.0', ttl: '1h' },
        { position: 'messages.1.content.2', ttl: '5m' }
      ],
      ['tool_use', 'thinking', 'text']
    ],
    [
      'redacted',
      { redactedData: '' },
      [
        { position: 'messages.1.content.0', ttl: '1h' },
        { position: 'messages.1.content.2', ttl: '5m' }
      ],
      ['tool_use', 'redacted_thinking', 'text']
    ]
  ])('uses emitted reasoning boundaries: %s', async (_name, metadata, expected, kinds) => {
    const input: LanguageModelV3CallOptions = {
      prompt: [
        textMessage('user', 'history '.repeat(1600)),
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 'call', toolName: 'lookup', input: {}, providerOptions: longMark },
            { type: 'reasoning', text: 'thought', providerOptions: { anthropic: metadata } },
            { type: 'text', text: 'answer' }
          ]
        }
      ]
    }
    const out = await transform(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 1 })
    )
    const body = JSON.parse(await captureBody(out))
    expect(extractBodyMarkers(body)).toEqual(expected)
    expect(body.messages[1].content.map((block: { type: string }) => block.type)).toEqual(kinds)
  })

  it('drops a root directive when four foreign tools already use the budget', async () => {
    const input = {
      prompt: [textMessage('user', 'hello')],
      tools: ['a', 'b', 'c', 'd'].map((name) => ({ ...makeTool(name), providerOptions: longMark })),
      providerOptions: shortMark
    }
    const out = await transform(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 0 })
    )
    const body = JSON.parse(await captureBody(out))
    expect(extractBodyMarkers(body)).toEqual(
      ['a', 'b', 'c', 'd'].map((_, i) => ({ position: `tools.${i}`, ttl: '1h' }))
    )
    expect(body.tools.map((tool: { name: string }) => tool.name)).toEqual(['a', 'b', 'c', 'd'])
    expect(body.cache_control).toBeUndefined()
  })

  it('keeps source-message fallback on its own final part across assistant messages', async () => {
    const input: LanguageModelV3CallOptions = {
      prompt: [
        {
          role: 'assistant',
          providerOptions: longMark,
          content: [
            { type: 'text', text: 'first' },
            { type: 'text', text: 'last of first' }
          ]
        },
        { role: 'assistant', content: [{ type: 'text', text: 'second' }] }
      ]
    }
    const out = await transform(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 0 })
    )
    expect(extractBodyMarkers(JSON.parse(await captureBody(out)))).toEqual([
      { position: 'messages.0.content.1', ttl: '1h' }
    ])
  })

  it('counts shared cacheable holders separately and copies only the rejected path', async () => {
    const shared = { type: 'text' as const, text: 'shared', providerOptions: longMark }
    const input: LanguageModelV3CallOptions = { prompt: [{ role: 'user', content: Array(5).fill(shared) }] }
    const out = await transformAnthropicCacheParams(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 0 }),
      undefined
    )
    const parts = out.prompt[0].content as (typeof shared)[]
    expect(parts.slice(0, 4).every((part) => part === shared)).toBe(true)
    expect(parts[4]).not.toBe(shared)
    expect(hasCacheControl(shared)).toBe(true)
    expect(extractBodyMarkers(JSON.parse(await captureBody(out))).map((marker) => marker.position)).toEqual([
      'messages.0.content.0',
      'messages.0.content.1',
      'messages.0.content.2',
      'messages.0.content.3'
    ])
  })

  it('keeps a compatible root directive with three distinct explicit markers', async () => {
    const input = {
      prompt: [textMessage('user', 'endpoint')],
      tools: ['a', 'b', 'c'].map((name) => ({ ...makeTool(name), providerOptions: longMark })),
      providerOptions: shortMark
    }
    const out = await transform(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 0 })
    )
    const body = JSON.parse(await captureBody(out))
    expect(extractBodyMarkers(body)).toEqual(['a', 'b', 'c'].map((_, i) => ({ position: `tools.${i}`, ttl: '1h' })))
    expect(body.tools.map((tool: { name: string }) => tool.name)).toEqual(['a', 'b', 'c'])
    expect(body.messages[0].content[0]).toMatchObject({ type: 'text', text: 'endpoint' })
    expect(body.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('rejects a different root TTL at the selected endpoint', async () => {
    const input = { prompt: [textMessage('user', 'request '.repeat(1600))], providerOptions: shortMark }
    const out = await transform(
      input,
      makeProvider({ enabled: true, ttl: '1h', cacheSystemMessage: false, cacheLastNMessages: 1 })
    )
    const body = JSON.parse(await captureBody(out))
    expect(extractBodyMarkers(body)).toEqual([{ position: 'messages.0.content.0', ttl: '1h' }])
    expect(body.cache_control).toBeUndefined()
  })

  it.each([
    ['output options present but undefined', true, false],
    ['output options absent', false, false],
    ['first item options mask later marker', false, true]
  ])('honors tool result output precedence: %s', async (_name, present, masked) => {
    const output = {
      type: 'content' as const,
      value: masked
        ? [
            { type: 'text' as const, text: 'first', providerOptions: { anthropic: { other: true } } },
            { type: 'text' as const, text: 'later', providerOptions: longMark }
          ]
        : [{ type: 'text' as const, text: 'result', providerOptions: longMark }],
      ...(present ? { providerOptions: undefined } : {})
    }
    const input: LanguageModelV3CallOptions = {
      prompt: [{ role: 'tool', content: [{ type: 'tool-result', toolName: 'lookup', toolCallId: 'id', output }] }]
    }
    const out = await transformAnthropicCacheParams(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 0 }),
      undefined
    )
    expect(out).toBe(input)
    expect(extractBodyMarkers(JSON.parse(await captureBody(out)))).toEqual(
      !present && !masked ? [{ position: 'messages.0.content.0', ttl: '1h' }] : []
    )
  })

  it('keeps a foreign late system marker before a user marker', async () => {
    const input = {
      prompt: [
        { ...textMessage('user', 'user'), providerOptions: longMark },
        { ...textMessage('system', 'system'), providerOptions: shortMark }
      ]
    }
    const out = await transform(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 0 })
    )
    expect(extractBodyMarkers(JSON.parse(await captureBody(out)))).toEqual([{ position: 'system.0', ttl: '5m' }])
  })

  it('ignores snake-case root metadata', async () => {
    const input = {
      prompt: [textMessage('user', 'user')],
      providerOptions: { anthropic: { cache_control: { type: 'ephemeral', ttl: '1h' } } }
    }
    const out = await transform(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 0 })
    )
    const body = JSON.parse(await captureBody(out))
    expect(body.cache_control).toBeUndefined()
    expect(extractBodyMarkers(body)).toEqual([])
    expect(out.providerOptions).toEqual(input.providerOptions)
  })

  it('does not treat disabled signed reasoning as an emitted boundary', async () => {
    const input: LanguageModelV3CallOptions = {
      providerOptions: { anthropic: { sendReasoning: false } },
      prompt: [
        textMessage('user', 'history '.repeat(1600)),
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 'call', toolName: 'lookup', input: {}, providerOptions: longMark },
            { type: 'reasoning', text: 'thought', providerOptions: { anthropic: { signature: 'signed' } } },
            { type: 'text', text: 'answer' }
          ]
        }
      ]
    }
    const out = await transform(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 1 })
    )
    const body = JSON.parse(await captureBody(out))
    expect(body.messages[1].content.map((block: { type: string }) => block.type)).toEqual(['text', 'tool_use'])
    expect(extractBodyMarkers(body)).toEqual([{ position: 'messages.1.content.0', ttl: '5m' }])
  })

  it('clamps adjacent assistant calls in emitted order', async () => {
    const input: LanguageModelV3CallOptions = {
      prompt: [
        textMessage('user', 'history '.repeat(1600)),
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'x', toolName: 'lookup', input: {}, providerOptions: longMark }]
        },
        textMessage('assistant', 'answer')
      ]
    }
    const out = await transform(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 1 })
    )
    expect(extractBodyMarkers(JSON.parse(await captureBody(out)))).toEqual([
      { position: 'messages.1.content.0', ttl: '5m' }
    ])
  })

  it('prioritizes a selected late system over an earlier user marker', async () => {
    const input = {
      prompt: [
        { ...textMessage('user', 'request'), providerOptions: longMark },
        textMessage('system', 'late system '.repeat(1600))
      ]
    }
    const out = await transform(input, makeProvider({ enabled: true, cacheSystemMessage: true, cacheLastNMessages: 0 }))
    expect(extractBodyMarkers(JSON.parse(await captureBody(out)))).toEqual([{ position: 'system.0', ttl: '5m' }])
  })

  it('removes an incompatible automatic root marker', async () => {
    const input = { prompt: [textMessage('user', 'request '.repeat(1600))], providerOptions: longMark }
    const out = await transform(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 1 })
    )
    const body = JSON.parse(await captureBody(out))
    expect(extractBodyMarkers(body)).toEqual([{ position: 'messages.0.content.0', ttl: '5m' }])
    expect(body.cache_control).toBeUndefined()
  })

  it('drops incoming 1h hints after the selected 5m tool in scenario A', async () => {
    const input = {
      tools: [makeTool('lookup', 20000)],
      prompt: [
        { ...textMessage('system', 'system'), providerOptions: longMark },
        { ...textMessage('user', 'first user'), providerOptions: longMark },
        textMessage('assistant', 'answer '.repeat(1600)),
        textMessage('user', 'last request '.repeat(1600))
      ]
    }
    const before = structuredClone(input)
    const out = await transform(input, provider)
    const markers = extractBodyMarkers(JSON.parse(await captureBody(out)))
    // The incoming system and first-user 1h hints must disappear after the selected 5m tool.
    expect(markers).toEqual([
      { position: 'tools.0', ttl: '5m' },
      { position: 'messages.1.content.0', ttl: '5m' },
      { position: 'messages.2.content.0', ttl: '5m' }
    ])
    expect(markers.length).toBeLessThanOrEqual(4)
    expect(markers.map(({ ttl }) => (ttl === '1h' ? 1 : 0))).toEqual([0, 0, 0])
    expect(input).toEqual(before)
  })

  it('keeps the effective tool-result hint without charging the shadowed output item in scenario B', async () => {
    const shadowed = { type: 'text' as const, text: 'shadowed', providerOptions: shortMark }
    const input: LanguageModelV3CallOptions = {
      tools: [makeTool('lookup', 20000)],
      prompt: [
        textMessage('system', 'system'),
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'shadowed',
              toolName: 'lookup',
              output: {
                type: 'content',
                value: [{ type: 'text', text: 'first', providerOptions: { anthropic: { signature: 'x' } } }, shadowed]
              }
            }
          ]
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'effective',
              toolName: 'lookup',
              output: { type: 'text', value: 'effective', providerOptions: shortMark }
            }
          ]
        },
        textMessage('assistant', 'answer '.repeat(1600)),
        textMessage('user', 'last request '.repeat(1600))
      ]
    }
    const before = structuredClone(input)
    const out = await transform(input, provider)
    const body: SerializedBody = JSON.parse(await captureBody(out))
    const markers = extractBodyMarkers(body)
    expect(markers).toEqual([
      { position: 'tools.0', ttl: '5m' },
      { position: 'messages.0.content.1', ttl: '5m' },
      { position: 'messages.1.content.0', ttl: '5m' },
      { position: 'messages.2.content.0', ttl: '5m' }
    ])
    expect(body.messages?.[0].content.find((block) => block.tool_use_id === 'effective')?.cache_control).toEqual({
      type: 'ephemeral'
    })
    expect(body.messages?.[0].content.find((block) => block.tool_use_id === 'shadowed')?.cache_control).toBeUndefined()
    expect(markers.length).toBeLessThanOrEqual(4)
    expect(out.prompt[1]).toBe(input.prompt[1])
    expect(input).toEqual(before)
  })

  it('keeps the valid 1h to 5m mix byte-for-byte in scenario C', async () => {
    const input = {
      prompt: [
        { ...textMessage('system', 'system '.repeat(1600)), providerOptions: longMark },
        textMessage('assistant', 'answer '.repeat(1600)),
        textMessage('user', 'last request '.repeat(1600))
      ]
    }
    const expected = {
      prompt: [
        input.prompt[0],
        ...input.prompt.slice(1).map((message) => ({
          ...message,
          content: [{ ...(message.content as { type: 'text'; text: string }[])[0], providerOptions: shortMark }]
        }))
      ]
    } as LanguageModelV3CallOptions
    const raw = await captureBody(await transform(input, provider))
    expect(raw).toBe(await captureBody(expected))
    expect(extractBodyMarkers(JSON.parse(raw)).map(({ ttl }) => ttl)).toEqual(['1h', '5m', '5m'])
  })

  it('clamps the reviewer shape in emitted assistant block order', async () => {
    const input: LanguageModelV3CallOptions = {
      prompt: [
        textMessage('user', 'history '.repeat(1600)),
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'shadowed',
              toolName: 'lookup',
              output: {
                type: 'content',
                value: [
                  { type: 'text', text: 'first', providerOptions: { anthropic: { signature: 'x' } } },
                  { type: 'text', text: 'shadowed', providerOptions: shortMark }
                ]
              }
            }
          ]
        },
        {
          role: 'assistant',
          providerOptions: longMark,
          content: [
            { type: 'tool-call', toolCallId: 'lookup', toolName: 'lookup', input: {}, providerOptions: longMark },
            { type: 'text', text: 'answer', providerOptions: shortMark }
          ]
        },
        textMessage('user', 'next request'),
        textMessage('assistant', 'final answer')
      ]
    }
    const before = structuredClone(input)
    const markers = extractBodyMarkers(JSON.parse(await captureBody(await transform(input, provider))))
    expect(markers.length).toBeLessThanOrEqual(4)
    const ranks = markers.map(({ ttl }) => (ttl === '1h' ? 1 : 0))
    expect(ranks.every((rank, i) => i === 0 || rank <= ranks[i - 1])).toBe(true)
    expect(markers).toEqual([
      { position: 'messages.1.content.0', ttl: '5m' },
      { position: 'messages.2.content.0', ttl: '5m' },
      { position: 'messages.3.content.0', ttl: '5m' }
    ])
    expect(input).toEqual(before)
  })

  it('keeps the 1h tool-call hint when the adapter drops an assistant file part', async () => {
    const input: LanguageModelV3CallOptions = {
      prompt: [
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 'lookup', toolName: 'lookup', input: {}, providerOptions: longMark },
            {
              type: 'file',
              data: new Uint8Array([1]),
              mediaType: 'application/pdf',
              providerOptions: shortMark
            }
          ]
        }
      ]
    }
    const before = structuredClone(input)
    const out = await transform(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 0 })
    )
    const body: SerializedBody = JSON.parse(await captureBody(out))
    expect(extractBodyMarkers(body)).toEqual([{ position: 'messages.0.content.0', ttl: '1h' }])
    expect(body.messages?.[0].content).toEqual([
      { type: 'tool_use', id: 'lookup', name: 'lookup', input: {}, cache_control: { type: 'ephemeral', ttl: '1h' } }
    ])
    expect(input).toEqual(before)
  })

  it('ignores assistant tool-result output hints and retains the later text message fallback', async () => {
    const input: LanguageModelV3CallOptions = {
      prompt: [
        {
          role: 'assistant',
          providerOptions: longMark,
          content: [
            {
              type: 'tool-result',
              toolCallId: 'search',
              toolName: 'web_search',
              output: { type: 'json', value: [], providerOptions: shortMark }
            },
            { type: 'text', text: 'search complete' }
          ]
        },
        textMessage('user', 'next request')
      ]
    }
    const out = await transform(
      input,
      makeProvider({ enabled: true, tokenThreshold: 1, cacheSystemMessage: false, cacheLastNMessages: 1 })
    )
    const markers = extractBodyMarkers(JSON.parse(await captureBody(out)))
    expect(markers).toEqual([
      { position: 'messages.0.content.1', ttl: '1h' },
      { position: 'messages.1.content.0', ttl: '5m' }
    ])
    expect(markers.length).toBeLessThanOrEqual(4)
  })

  it('returns a valid unselected request unchanged and preserves all shadowed hints', async () => {
    const input: LanguageModelV3CallOptions = {
      prompt: [
        { ...textMessage('system', 'system'), providerOptions: longMark },
        {
          role: 'user',
          providerOptions: longMark,
          content: [{ type: 'text', text: 'user', providerOptions: shortMark }]
        },
        {
          role: 'tool',
          providerOptions: longMark,
          content: [
            {
              type: 'tool-result',
              toolCallId: 'result',
              toolName: 'lookup',
              providerOptions: shortMark,
              output: { type: 'content', value: [{ type: 'text', text: 'result', providerOptions: longMark }] }
            }
          ]
        }
      ]
    }
    const before = structuredClone(input)
    const out = await transformAnthropicCacheParams(
      input,
      makeProvider({ enabled: true, tokenThreshold: 999999 }),
      undefined
    )
    expect(out).toBe(input)
    expect(input).toEqual(before)
    expect(extractBodyMarkers(JSON.parse(await captureBody(out))).map(({ ttl }) => ttl)).toEqual(['1h', '5m', '5m'])
  })

  it('removes shorter foreign hints before a selected 1h marker without dropping the selection', async () => {
    const input = {
      tools: [{ ...makeTool('a'), providerOptions: shortMark }, makeTool('zeta', 20000)],
      prompt: [textMessage('user', 'request')]
    }
    const out = await transform(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 1, ttl: '1h' })
    )
    expect(extractBodyMarkers(JSON.parse(await captureBody(out)))).toEqual([
      { position: 'tools.1', ttl: '1h' },
      { position: 'messages.0.content.0', ttl: '1h' }
    ])
  })

  it('retains compatible 1h hints before selected 5m markers within the four-marker limit', async () => {
    const input = {
      tools: ['a', 'b', 'c', 'd', 'zeta'].map((name) => ({ ...makeTool(name, 20000), providerOptions: longMark })),
      prompt: [textMessage('user', 'request')]
    }
    const out = await transform(input, provider)
    expect(extractBodyMarkers(JSON.parse(await captureBody(out)))).toEqual([
      { position: 'tools.0', ttl: '1h' },
      { position: 'tools.1', ttl: '1h' },
      { position: 'tools.4', ttl: '5m' },
      { position: 'messages.0.content.0', ttl: '5m' }
    ])
  })

  it('rechecks a fallback that becomes effective after an incompatible part hint is removed', async () => {
    const input: LanguageModelV3CallOptions = {
      tools: [makeTool('lookup', 20000)],
      prompt: [
        {
          role: 'user',
          providerOptions: longMark,
          content: [{ type: 'text', text: 'request', providerOptions: longMark }]
        }
      ]
    }
    const before = structuredClone(input)
    const out = await transform(
      input,
      makeProvider({ enabled: true, cacheSystemMessage: false, cacheLastNMessages: 0 })
    )
    expect(extractBodyMarkers(JSON.parse(await captureBody(out)))).toEqual([{ position: 'tools.0', ttl: '5m' }])
    expect(input).toEqual(before)
  })

  it('returns non-array prompts untouched', async () => {
    const input = { prompt: undefined } as unknown as LanguageModelV3CallOptions
    expect(await transformAnthropicCacheParams(input, provider, undefined)).toBe(input)
  })
  it.each(['mcp__mysql__query', 'mcp__cherry-tools__web_search', 'large_mcp_tool'])(
    'clamps ordinary local tool %s',
    async (name) => {
      const input: LanguageModelV3CallOptions = {
        prompt: [
          {
            role: 'assistant',
            content: [{ type: 'tool-call', toolCallId: 'call', toolName: name, input: {}, providerOptions: longMark }]
          },
          { role: 'assistant', content: [{ type: 'text', text: 'answer' }] }
        ]
      }
      expect(deriveEmittedCacheSlots(input)).toBeDefined()
      const out = await transform(
        input,
        makeProvider({ enabled: true, tokenThreshold: 1, cacheSystemMessage: false, cacheLastNMessages: 1 })
      )
      const body = JSON.parse(await captureBody(out))
      expect(body.messages[0].content.map((part: { type: string }) => part.type)).toEqual(['text', 'tool_use'])
      expect(extractBodyMarkers(body)).toEqual([{ position: 'messages.0.content.0', ttl: '5m' }])
    }
  )

  it('keeps ignored options and unused reasoning metadata in scope', async () => {
    const input = {
      prompt: [
        {
          role: 'assistant' as const,
          providerOptions: { anthropic: { effort: 'low' } },
          content: [
            { type: 'reasoning' as const, text: 'r', providerOptions: { anthropic: { signature: 123 } } },
            {
              type: 'text' as const,
              text: 'answer',
              providerOptions: { anthropic: { type: 'compaction-ish', toolsetName: 123 } }
            }
          ]
        }
      ],
      providerOptions: { anthropic: { sendReasoning: false, mcpServers: [], toolsets: {} } }
    }
    expect(deriveEmittedCacheSlots(input)).toBeDefined()
    const out = await transform(
      input,
      makeProvider({ enabled: true, tokenThreshold: 1, cacheSystemMessage: false, cacheLastNMessages: 1 })
    )
    expect(extractBodyMarkers(JSON.parse(await captureBody(out)))).toEqual([
      { position: 'messages.0.content.0', ttl: '5m' }
    ])
  })

  it('uses whitespace and emitted tools as automatic endpoints', async () => {
    const cases: LanguageModelV3CallOptions[] = [
      {
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'first' },
              { type: 'text', text: ' ', providerOptions: longMark }
            ]
          }
        ],
        providerOptions: shortMark
      },
      {
        prompt: [],
        tools: [
          { ...makeTool('first'), providerOptions: longMark },
          { type: 'provider', id: 'unknown.feature', name: 'ignored', args: {} }
        ],
        providerOptions: shortMark
      }
    ]
    for (const [i, input] of cases.entries()) {
      const out = await transformAnthropicCacheParams(
        input,
        makeProvider({ enabled: true, tokenThreshold: 999999, cacheSystemMessage: false, cacheLastNMessages: 0 }),
        undefined
      )
      const body = JSON.parse(await captureBody(out))
      expect(extractBodyMarkers(body)).toEqual([{ position: i ? 'tools.0' : 'messages.0.content.1', ttl: '1h' }])
      expect(body.cache_control).toBeUndefined()
    }
    expect(deriveEmittedCacheSlots({ prompt: [], tools: [] })?.tools).toBeUndefined()
  })

  it('respects custom namespace options through the model middleware', async () => {
    const provider = makeProvider({
      enabled: true,
      tokenThreshold: 999999,
      cacheSystemMessage: false,
      cacheLastNMessages: 0
    })
    const plugin = anthropicCacheFeature.contributeModelAdapters!({ provider } as never)[0] as any
    const context = { middlewares: [] as any[] }
    plugin.configureContext(context)
    const capture = async (input: LanguageModelV3CallOptions) => {
      let body: any
      const model = new AnthropicMessagesLanguageModel('claude-sonnet-4-5', {
        provider: 'cherryin.anthropic',
        baseURL: 'http://localhost/v1',
        headers: () => ({ 'x-api-key': 'test' }),
        fetch: async (_url, init) => {
          body = JSON.parse(String(init?.body))
          throw new Error('Captured request')
        }
      })
      const wrapped = wrapLanguageModel({ model, middleware: context.middlewares[0] })
      await expect(wrapped.doGenerate({ ...input, maxOutputTokens: 100 })).rejects.toThrow('Captured request')
      return body
    }
    const prompt: LanguageModelV3Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'r', providerOptions: { anthropic: { signature: 'signed' } } },
          { type: 'text', text: 'answer', providerOptions: shortMark }
        ]
      }
    ]
    const base = {
      prompt,
      providerOptions: {
        anthropic: { ...longMark.anthropic },
        cherryin: { sendReasoning: false, cacheControl: { type: 'ephemeral' } }
      }
    }
    const body = await capture(base)
    expect(body.messages[0].content.map((part: { type: string }) => part.type)).toEqual(['text'])
    expect(extractBodyMarkers(body)).toEqual([{ position: 'messages.0.content.0', ttl: '5m' }])
    expect(body.cache_control).toEqual({ type: 'ephemeral' })
    const exposed = await capture({
      ...base,
      providerOptions: { anthropic: shortMark.anthropic, cherryin: { sendReasoning: false, ...longMark.anthropic } }
    })
    expect(exposed.cache_control).toEqual({ type: 'ephemeral' })
    const masked = {
      ...base,
      providerOptions: { anthropic: longMark.anthropic, cherryin: { sendReasoning: false, cacheControl: undefined } }
    }
    const untouched = await transformAnthropicCacheParams(masked, provider, undefined, 'cherryin.anthropic')
    expect(untouched).toBe(masked)
    expect(untouched.providerOptions?.anthropic).toBe(masked.providerOptions.anthropic)
    expect((await capture(masked)).cache_control).toBeUndefined()
  })
})

describe('adapter structural oracle', () => {
  const long = { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } }
  const short = { anthropic: { cacheControl: { type: 'ephemeral' } } }
  const provider = makeProvider({
    enabled: true,
    tokenThreshold: 999999,
    cacheSystemMessage: false,
    cacheLastNMessages: 0
  })
  const call = (id: string, name: string, native = false) => ({
    type: 'tool-call' as const,
    toolCallId: id,
    toolName: name,
    input: { cache_control: 'argument' },
    ...(native ? { providerExecuted: true } : {})
  })
  const result = (id: string, name: string, output: LanguageModelV3ToolResultOutput) => ({
    type: 'tool-result' as const,
    toolCallId: id,
    toolName: name,
    output
  })

  async function verify(
    input: LanguageModelV3CallOptions,
    expected: { position: string; ttl: string }[],
    root?: string
  ) {
    const out = await transformAnthropicCacheParams(input, provider, undefined)
    const plan = deriveEmittedCacheSlots(out)!
    const body = JSON.parse(await captureBody(out))
    const original = JSON.parse(await captureBody(input))
    const wireBlock = (block: any, tool = false) => ({
      kind: tool ? (block.type ?? 'tool') : block.type,
      identity: tool
        ? block.name
        : block.type === 'text'
          ? block.text
          : block.type === 'thinking'
            ? block.thinking
            : block.type === 'redacted_thinking'
              ? block.data
              : block.type === 'image' || block.type === 'document'
                ? (block.source.url ?? block.source.data)
                : block.type === 'tool_use' || block.type === 'server_tool_use'
                  ? [block.name, block.id]
                  : block.tool_use_id
    })
    const projected = (slot: { kind: string; identity: unknown }) => ({ kind: slot.kind, identity: slot.identity })
    expect(plan.tools?.map(projected)).toEqual(body.tools?.map((block: any) => wireBlock(block, true)))
    expect(plan.system?.map(projected)).toEqual(body.system?.map((block: any) => wireBlock(block)))
    expect(plan.messages.map((message) => ({ role: message.role, content: message.content.map(projected) }))).toEqual(
      body.messages.map((message: any) => ({
        role: message.role,
        content: message.content.map((block: any) => wireBlock(block))
      }))
    )
    expect(extractBodyMarkers(body)).toEqual(expected)
    expect(body.cache_control?.ttl ?? (body.cache_control ? '5m' : undefined)).toBe(root)
    expect(expected.length + (root ? 1 : 0)).toBeLessThanOrEqual(4)
    const omitKnownCache = (value: any) => {
      delete value.cache_control
      for (const block of [
        ...(value.tools ?? []),
        ...(value.system ?? []),
        ...value.messages.flatMap((m: any) => m.content)
      ]) {
        delete block.cache_control
      }
      return value
    }
    expect(omitKnownCache(body)).toEqual(omitKnownCache(original))
  }

  it('checks a retained root separately from the endpoint', async () => {
    await verify({ prompt: [textMessage('user', 'root endpoint')], providerOptions: short }, [], '5m')
  })

  it('matches separate inline systems and hoisted system', async () => {
    await verify(
      {
        prompt: [
          textMessage('system', 'top'),
          textMessage('user', 'u'),
          { ...textMessage('system', 'inline-a'), providerOptions: long },
          { ...textMessage('system', 'inline-b'), providerOptions: short }
        ]
      },
      [
        { position: 'messages.1.content.0', ttl: '1h' },
        { position: 'messages.2.content.0', ttl: '5m' }
      ]
    )
  })

  it('matches assistant grouping, separator and cross-message thinking boundary', async () => {
    await verify(
      {
        prompt: [
          textMessage('user', 'separator'),
          { role: 'assistant', content: [call('a', 'local'), { type: 'text', text: 'first' }] },
          {
            role: 'assistant',
            content: [
              { type: 'reasoning', text: 'thought', providerOptions: { anthropic: { signature: 'sig' } } },
              { type: 'text', text: 'second', providerOptions: short },
              call('b', 'other')
            ]
          },
          textMessage('user', 'separator two'),
          textMessage('assistant', 'last')
        ]
      },
      [{ position: 'messages.1.content.3', ttl: '5m' }]
    )
  })

  it('matches grouped user, tool and media blocks including duplicate media types', async () => {
    await verify(
      {
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'file', mediaType: 'image/png', data: new Uint8Array([1]) },
              { type: 'file', mediaType: 'image/png', data: new Uint8Array([2]) },
              { type: 'file', mediaType: 'application/pdf', data: new Uint8Array([3]) },
              { type: 'file', mediaType: 'text/plain', data: new Uint8Array([65, 66]) }
            ]
          },
          {
            role: 'tool',
            content: [
              result('r', 'local', { type: 'text', value: 'ok' }),
              { type: 'tool-approval-response', approvalId: 'approval', approved: true }
            ]
          },
          { role: 'user', content: [{ type: 'text', text: 'end', providerOptions: short }] }
        ]
      },
      [{ position: 'messages.0.content.5', ttl: '5m' }]
    )
  })

  it.each(['web_search', 'web_fetch'])('matches aliased %s native calls and results', async (name) => {
    const output =
      name === 'web_search'
        ? []
        : {
            type: 'web_fetch_result',
            url: 'https://example.com',
            content: {
              type: 'document',
              title: null,
              source: { type: 'text', mediaType: 'text/plain', data: 'found' }
            },
            retrievedAt: null
          }
    await verify(
      {
        tools: [
          {
            type: 'provider',
            id: `anthropic.${name}_${name === 'web_search' ? '20250305' : '20250910'}`,
            name: 'alias',
            args: {}
          }
        ],
        prompt: [
          {
            role: 'assistant',
            content: [
              call('local-id', 'local'),
              { ...call('native-id', 'alias', true), providerOptions: long },
              result('native-id', 'alias', {
                type: 'error-json',
                value: { errorCode: 'unavailable' },
                providerOptions: short
              }),
              result('json-id', 'alias', { type: 'json', value: output }),
              result('drop-id', 'alias', { type: 'text', value: 'unsupported' })
            ]
          }
        ]
      },
      [{ position: 'messages.0.content.0', ttl: '1h' }]
    )
  })

  it.each([[[]], [[{ type: 'provider', id: 'unknown.feature', name: 'ignored', args: {} }]]])(
    'matches tools presence for %j',
    async (tools) => {
      await verify({ prompt: [textMessage('user', 'hello')], tools } as LanguageModelV3CallOptions, [])
    }
  )
})

describe('cache preservation controls', () => {
  const long = {
    anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' }, cache_control: { type: 'ephemeral', ttl: '1h' } },
    other: { keep: true }
  }
  const selectTool = makeProvider({
    enabled: true,
    tokenThreshold: 1,
    cacheSystemMessage: false,
    cacheLastNMessages: 0
  })
  it.each([
    [
      'reasoning',
      {
        type: 'reasoning',
        text: 'thought',
        providerOptions: { ...long, anthropic: { ...long.anthropic, signature: 'sig', redactedData: 'redacted' } }
      }
    ],
    ['file', { type: 'file', mediaType: 'image/png', data: new Uint8Array([1]), providerOptions: long }],
    [
      'result',
      {
        type: 'tool-result',
        toolName: 'unknown',
        toolCallId: 'dead',
        output: { type: 'text', value: 'ignored' },
        providerOptions: long
      }
    ]
  ])('clears dead last %s and its message fallback before selecting a tool', async (_name, part) => {
    const input = {
      tools: [makeTool('selected', 6000)],
      prompt: [{ role: 'assistant', content: [part], providerOptions: long }]
    } as LanguageModelV3CallOptions
    const out = await transformAnthropicCacheParams(input, selectTool, undefined)
    const body = JSON.parse(await captureBody(out))
    expect(extractBodyMarkers(body)).toEqual([{ position: 'tools.0', ttl: '5m' }])
    expect(body.tools[0].name).toBe('selected')
    expect(hasCacheControl(out.prompt[0])).toBe(false)
    const actual = (out.prompt[0].content as any[])[0]
    expect(hasCacheControl(actual)).toBe(false)
    expect(actual.providerOptions.other).toEqual({ keep: true })
    if (part.type === 'reasoning')
      expect(actual.providerOptions.anthropic).toEqual({ signature: 'sig', redactedData: 'redacted' })
    expect(hasCacheControl(input.prompt[0])).toBe(true)
  })

  it('does not retarget a selection on a dropped last part', async () => {
    const input: LanguageModelV3CallOptions = {
      prompt: [
        textMessage('user', 'old'),
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'live '.repeat(1000) },
            { type: 'file', mediaType: 'image/png', data: new Uint8Array([1]) }
          ]
        }
      ]
    }
    const out = await transformAnthropicCacheParams(
      input,
      makeProvider({ enabled: true, tokenThreshold: 1, cacheSystemMessage: false, cacheLastNMessages: 1 }),
      undefined
    )
    expect(extractBodyMarkers(JSON.parse(await captureBody(out)))).toEqual([])
    expect(countCacheMarkers(out)).toBe(0)
  })

  it('clears each rejected tool-result fallback and preserves a shadowed retained hint', async () => {
    const input: LanguageModelV3CallOptions = {
      tools: [makeTool('selected', 6000)],
      prompt: [
        {
          role: 'tool',
          providerOptions: long,
          content: [
            {
              type: 'tool-result',
              toolName: 'local',
              toolCallId: 'first',
              providerOptions: long,
              output: { type: 'text', value: 'first', providerOptions: long }
            }
          ]
        },
        { role: 'user', content: [{ type: 'text', text: 'separator' }] },
        {
          role: 'tool',
          providerOptions: long,
          content: [
            {
              type: 'tool-result',
              toolName: 'local',
              toolCallId: 'second',
              providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
              output: { type: 'text', value: 'second', providerOptions: long }
            }
          ]
        }
      ]
    }
    const chainOnly = await transformAnthropicCacheParams(
      { ...input, prompt: [input.prompt[0]] },
      selectTool,
      undefined
    )
    expect(extractBodyMarkers(JSON.parse(await captureBody(chainOnly)))).toEqual([{ position: 'tools.0', ttl: '5m' }])
    const out = await transformAnthropicCacheParams(input, selectTool, undefined)
    expect(extractBodyMarkers(JSON.parse(await captureBody(out)))).toEqual([
      { position: 'tools.0', ttl: '5m' },
      { position: 'messages.0.content.2', ttl: '5m' }
    ])
    const first = (out.prompt[0].content as any[])[0]
    expect([hasCacheControl(first), hasCacheControl(first.output), hasCacheControl(out.prompt[0])]).toEqual([
      false,
      false,
      false
    ])
    const second = (out.prompt[2].content as any[])[0]
    expect(hasCacheControl(second.output)).toBe(true)
    expect(hasCacheControl(out.prompt[2])).toBe(true)
  })

  it('keeps clamping with Qwen header insertion and a leading system', async () => {
    const input: LanguageModelV3CallOptions = {
      tools: [{ type: 'provider', id: 'anthropic.web_search_20250305', name: 'web_search', args: {} }],
      prompt: [
        textMessage('system', 'system'),
        { ...textMessage('user', 'request '.repeat(1600)), providerOptions: long }
      ]
    }
    const out = await transformAnthropicCacheParams(
      input,
      makeProvider({ enabled: true, tokenThreshold: 1, cacheSystemMessage: true, cacheLastNMessages: 0 }),
      undefined
    )
    const params = await createQwenAnthropicWebToolsMiddleware().transformParams!({
      type: 'generate',
      params: out,
      model: {} as never
    })
    const body = JSON.parse(await captureBody(params))
    expect(body.system.map((block: { text: string }) => block.text)).toEqual([
      'x-anthropic-billing-header: cc_entrypoint=cli;',
      'system'
    ])
    expect(extractBodyMarkers(body)).toEqual([{ position: 'system.1', ttl: '5m' }])
  })
})
