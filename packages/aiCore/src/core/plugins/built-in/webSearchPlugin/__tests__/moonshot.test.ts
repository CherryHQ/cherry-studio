import { describe, expect, it } from 'vitest'

import { createMockContext } from '../../../../../__tests__'
import type { StreamTextParams } from '../../../types'
import { webSearchPlugin } from '../index'

type ToolLike = {
  type?: string
  isBuiltin?: boolean
  definition?: {
    type?: string
    function?: { name?: string }
  }
  execute?: (argumentsPayload: unknown) => Promise<unknown>
}

type ToolMap = Record<string, ToolLike>

describe('Moonshot Web Search', () => {
  it('should inject $web_search tool for moonshot provider', async () => {
    const plugin = webSearchPlugin({ moonshot: true })

    const params: StreamTextParams = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search for something' }]
    }

    const context = createMockContext({
      providerId: 'moonshot',
      originalParams: params
    })
    const result = await plugin.transformParams!(params, context)
    const resultTools = (result.tools ?? {}) as ToolMap

    expect(resultTools).toBeDefined()
    expect(Array.isArray(resultTools)).toBe(false)
    expect(typeof resultTools).toBe('object')

    expect(resultTools).toHaveProperty('$web_search')
    expect(resultTools.$web_search).toMatchObject({
      type: 'provider',
      isBuiltin: true,
      definition: {
        type: 'builtin_function',
        function: { name: '$web_search' }
      }
    })
  })

  it('should return arguments unchanged in moonshot builtin execute fallback', async () => {
    const plugin = webSearchPlugin({ moonshot: true })
    const params: StreamTextParams = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search for something' }]
    }
    const context = createMockContext({
      providerId: 'moonshot',
      originalParams: params
    })
    const result = await plugin.transformParams!(params, context)

    const execute = (result.tools as ToolMap).$web_search.execute
    expect(execute).toBeDefined()
    const argumentsPayload = {
      search_result: { search_id: 'search_123' },
      usage: { total_tokens: 42 }
    }
    const executeResult = await execute?.(argumentsPayload)

    expect(executeResult).toEqual(argumentsPayload)
  })

  it('should handle tools as empty array', async () => {
    const plugin = webSearchPlugin({ moonshot: true })

    const params = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search' }],
      tools: []
    } as unknown as StreamTextParams

    const context = createMockContext({
      providerId: 'moonshot',
      originalParams: params
    })
    const result = await plugin.transformParams!(params, context)

    expect(Array.isArray(result.tools)).toBe(false)
    expect(typeof result.tools).toBe('object')

    expect(result.tools).toHaveProperty('$web_search')
  })

  it('should not inject tools when disabled', async () => {
    const plugin = webSearchPlugin({ moonshot: false })

    const params: StreamTextParams = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Hello' }]
    }

    const context = createMockContext({
      providerId: 'moonshot',
      originalParams: params
    })
    const result = await plugin.transformParams!(params, context)

    expect(result.tools).toBeUndefined()
  })

  it('should use default config when moonshot is not specified', async () => {
    const plugin = webSearchPlugin({})

    const params: StreamTextParams = {
      model: 'kimi-k2.5',
      messages: [{ role: 'user', content: 'Search' }]
    }

    const context = createMockContext({
      providerId: 'moonshot',
      originalParams: params
    })
    const result = await plugin.transformParams!(params, context)

    expect(result.tools).toBeDefined()
    expect(result.tools).toHaveProperty('$web_search')
  })
})

describe('tools normalization behavior', () => {
  it('should preserve existing tool object entries', async () => {
    const plugin = webSearchPlugin({ moonshot: true })
    const params = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search' }],
      tools: {
        existing: {
          type: 'provider'
        }
      }
    } as unknown as StreamTextParams
    const context = createMockContext({
      providerId: 'moonshot',
      originalParams: params
    })

    const result = await plugin.transformParams!(params, context)
    expect(result.tools).toHaveProperty('existing')
    expect(result.tools).toHaveProperty('$web_search')
  })
})
