import type { ChatCompletionCreateParams } from '@cherrystudio/openai/resources'
import type { Provider } from '@types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('../../utils', () => ({
  validateModelId: vi.fn()
}))

import { normalizeMoonshotBuiltinSearchTool } from '../chat-completion'

const createProvider = (id: string): Provider =>
  ({
    id,
    type: 'openai',
    apiHost: 'https://api.example.com/v1',
    apiKey: 'test-api-key'
  }) as Provider

const createBaseRequest = (): ChatCompletionCreateParams => ({
  model: 'moonshot:kimi-k2-0711-preview',
  messages: [{ role: 'user', content: 'Search and summarize Qwen3.5 model series' }]
})

describe('normalizeMoonshotBuiltinSearchTool', () => {
  it('injects builtin_function $web_search when tools is missing', () => {
    const request = createBaseRequest()
    const provider = createProvider('moonshot')

    const normalized = normalizeMoonshotBuiltinSearchTool(request, provider)

    expect(Array.isArray(normalized.tools)).toBe(true)
    expect(normalized.tools).toHaveLength(1)
    expect(normalized.tools?.[0]).toMatchObject({
      type: 'builtin_function',
      function: { name: '$web_search' }
    })
  })

  it('injects builtin_function $web_search when tools is an empty array', () => {
    const request: ChatCompletionCreateParams = {
      ...createBaseRequest(),
      tools: []
    }
    const provider = createProvider('moonshot')

    const normalized = normalizeMoonshotBuiltinSearchTool(request, provider)

    expect(normalized.tools).toHaveLength(1)
    expect(normalized.tools?.[0]).toMatchObject({
      type: 'builtin_function',
      function: { name: '$web_search' }
    })
  })

  it('keeps existing function tools and appends builtin_function $web_search', () => {
    const request: ChatCompletionCreateParams = {
      ...createBaseRequest(),
      tools: [
        {
          type: 'function',
          function: {
            name: 'my_custom_tool',
            parameters: {
              type: 'object',
              properties: {},
              required: []
            }
          }
        }
      ]
    }
    const provider = createProvider('moonshot')

    const normalized = normalizeMoonshotBuiltinSearchTool(request, provider)

    expect(normalized.tools).toHaveLength(2)
    expect(normalized.tools?.[0]).toMatchObject({
      type: 'function',
      function: { name: 'my_custom_tool' }
    })
    expect(normalized.tools?.[1]).toMatchObject({
      type: 'builtin_function',
      function: { name: '$web_search' }
    })
  })

  it('does not duplicate when builtin_function $web_search already exists', () => {
    const moonshotBuiltinTool = {
      type: 'builtin_function',
      function: { name: '$web_search' }
    } as unknown as NonNullable<ChatCompletionCreateParams['tools']>[number]

    const request: ChatCompletionCreateParams = {
      ...createBaseRequest(),
      tools: [moonshotBuiltinTool]
    }
    const provider = createProvider('moonshot')

    const normalized = normalizeMoonshotBuiltinSearchTool(request, provider)

    expect(normalized.tools).toHaveLength(1)
    expect(normalized.tools?.[0]).toMatchObject({
      type: 'builtin_function',
      function: { name: '$web_search' }
    })
  })

  it('does not inject when tool_choice is none', () => {
    const request: ChatCompletionCreateParams = {
      ...createBaseRequest(),
      tool_choice: 'none'
    }
    const provider = createProvider('moonshot')

    const normalized = normalizeMoonshotBuiltinSearchTool(request, provider)

    expect(normalized.tools).toBeUndefined()
  })

  it('does not inject for non-moonshot providers', () => {
    const request = createBaseRequest()
    const provider = createProvider('openai')

    const normalized = normalizeMoonshotBuiltinSearchTool(request, provider)

    expect(normalized.tools).toBeUndefined()
  })

  it('injects for custom provider id when apiHost points to moonshot.cn', () => {
    const request = createBaseRequest()
    const provider = {
      ...createProvider('my-moonshot'),
      apiHost: 'https://api.moonshot.cn/v1'
    } as Provider

    const normalized = normalizeMoonshotBuiltinSearchTool(request, provider)

    expect(normalized.tools).toHaveLength(1)
    expect(normalized.tools?.[0]).toMatchObject({
      type: 'builtin_function',
      function: { name: '$web_search' }
    })
  })
})
