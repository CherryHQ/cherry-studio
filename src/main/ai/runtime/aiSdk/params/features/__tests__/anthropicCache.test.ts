import type { LanguageModelV3CallOptions, LanguageModelV3FunctionTool, LanguageModelV3Message } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import type { Assistant } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { anthropicCacheFeature, transformAnthropicCacheParams } from '../anthropicCache'

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
          role: 'assistant',
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

    expect(countCacheMarkers(out)).toBe(1)
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
    expect(out.tools?.filter(hasCacheControl).map((t) => t.name)).toEqual(['d', 'c', 'b', 'a'])
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
