import type { LanguageModelV3CallOptions, LanguageModelV3FunctionTool, LanguageModelV3Message } from '@ai-sdk/provider'
import type { Assistant } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

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

function hasCacheControl(value: { providerOptions?: unknown }): boolean {
  return Boolean(
    (value.providerOptions as { anthropic?: { cacheControl?: unknown } } | undefined)?.anthropic?.cacheControl
  )
}

function countCacheMarkers(params: LanguageModelV3CallOptions): number {
  let count = 0
  for (const tool of params.tools ?? []) {
    if ('providerOptions' in tool && hasCacheControl(tool)) count++
  }
  for (const message of params.prompt) {
    if (hasCacheControl(message)) count++
    if (typeof message.content !== 'string') {
      for (const part of message.content) {
        if ('providerOptions' in part && hasCacheControl(part)) count++
      }
    }
  }
  return count
}

async function transform(
  input: Partial<LanguageModelV3CallOptions>,
  provider = makeProvider(),
  model = makeModel(),
  assistant?: Assistant
): Promise<LanguageModelV3CallOptions> {
  return transformAnthropicCacheParams(
    {
      prompt: [textMessage('system', 'system'), textMessage('user', 'hello')],
      ...input
    } as LanguageModelV3CallOptions,
    provider,
    model,
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
})

describe('transformAnthropicCacheParams', () => {
  it('does not emit markers when explicitly disabled', async () => {
    const out = await transform(
      { prompt: [textMessage('system', 'x '.repeat(3000))] },
      makeProvider({ enabled: false, tokenThreshold: 1024 })
    )

    expect(countCacheMarkers(out)).toBe(0)
  })

  it('does not emit markers below the model-aware minimum prefix', async () => {
    const out = await transform({ prompt: [textMessage('system', 'short')] })

    expect(countCacheMarkers(out)).toBe(0)
  })

  it('uses the Haiku minimum instead of a lower configured threshold', async () => {
    const out = await transform(
      { prompt: [textMessage('system', 'x '.repeat(1300))] },
      makeProvider({ enabled: true, tokenThreshold: 1024 }),
      makeModel({ id: 'anthropic::claude-3-haiku', name: 'Claude 3 Haiku' })
    )

    expect(countCacheMarkers(out)).toBe(0)
  })

  it('keeps marker count under Anthropic’s four-breakpoint ceiling', async () => {
    const out = await transform({
      prompt: [
        textMessage('system', 'x '.repeat(3000)),
        textMessage('user', 'u '.repeat(3000)),
        textMessage('assistant', 'a '.repeat(3000)),
        textMessage('user', 'u '.repeat(3000)),
        textMessage('assistant', 'a '.repeat(3000))
      ],
      tools: [makeTool('z_tool', 5000), makeTool('a_tool', 5000)]
    })

    expect(countCacheMarkers(out)).toBeLessThanOrEqual(4)
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

  it('serializes the same selected tool set identically across transforms', async () => {
    const input = {
      tools: [makeTool('z_tool', 2000), makeTool('a_tool', 2000)],
      prompt: [textMessage('system', 'short')]
    }

    const first = await transform(input)
    const second = await transform(input)

    expect(JSON.stringify(first.tools)).toBe(JSON.stringify(second.tools))
  })

  it('skips only the system marker for volatile time prompts', async () => {
    const out = await transform(
      {
        prompt: [textMessage('system', 'x '.repeat(3000))],
        tools: [makeTool('mcp_tool', 6000)]
      },
      makeProvider(),
      makeModel(),
      { id: 'a1', prompt: 'Current time: {{time}}' } as Assistant
    )

    expect(hasCacheControl(out.prompt[0])).toBe(false)
    expect(out.tools?.filter((tool) => 'providerOptions' in tool && hasCacheControl(tool))).toHaveLength(1)
  })
})
