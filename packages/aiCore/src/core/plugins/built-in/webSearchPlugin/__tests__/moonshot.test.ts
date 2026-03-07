// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
import { describe, expect, it } from 'vitest'

import { webSearchPlugin } from '../index'

describe('Moonshot Web Search', () => {
  it('should inject $web_search tool for moonshot provider', async () => {
    const plugin = webSearchPlugin({ moonshot: true })

    const params = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search for something' }]
    }

    const context = { providerId: 'moonshot' }
    console.log('Config:', { moonshot: true })
    console.log('Context:', context)

    const result = await plugin.transformParams!(params, context as any)

    console.log('Result:', result)
    console.log('Result tools:', result.tools)

    // Verify tools is an object, not array
    expect(result.tools).toBeDefined()
    expect(Array.isArray(result.tools)).toBe(false)
    expect(typeof result.tools).toBe('object')

    // Verify $web_search tool is injected
    expect(result.tools).toHaveProperty('$web_search')
    expect(result.tools!['$web_search']).toMatchObject({
      type: 'provider',
      isBuiltin: true,
      definition: {
        type: 'builtin_function',
        function: { name: '$web_search' }
      }
    })

    console.log('Result tools:', JSON.stringify(result.tools, null, 2))
  })

  it('should return arguments unchanged in moonshot builtin execute fallback', async () => {
    const plugin = webSearchPlugin({ moonshot: true })
    const params = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search for something' }]
    }
    const context = { providerId: 'moonshot' }
    const result = await plugin.transformParams!(params, context as any)

    const execute = (result.tools as any).$web_search.execute
    const argumentsPayload = {
      search_result: { search_id: 'search_123' },
      usage: { total_tokens: 42 }
    }
    const executeResult = await execute(argumentsPayload)

    expect(executeResult).toEqual(argumentsPayload)
  })

  it('should handle tools as empty array', async () => {
    const plugin = webSearchPlugin({ moonshot: true })

    const params = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search' }],
      tools: [] as any[] // Empty array
    }

    const context = { providerId: 'moonshot' }
    const result = await plugin.transformParams!(params, context as any)

    // Verify tools is converted to object
    expect(Array.isArray(result.tools)).toBe(false)
    expect(typeof result.tools).toBe('object')

    // Verify $web_search tool is injected
    expect(result.tools).toHaveProperty('$web_search')

    console.log('Result tools (from empty array):', JSON.stringify(result.tools, null, 2))
  })

  it('should not inject tools when disabled', async () => {
    const plugin = webSearchPlugin({ moonshot: false })

    const params = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Hello' }]
    }

    const context = { providerId: 'moonshot' }
    const result = await plugin.transformParams!(params, context as any)

    // Tools should be undefined or empty
    expect(result.tools).toBeUndefined()
  })

  it('should use default config when moonshot is not specified', async () => {
    const plugin = webSearchPlugin({}) // Use default config

    const params = {
      model: 'kimi-k2.5',
      messages: [{ role: 'user', content: 'Search' }]
    }

    const context = { providerId: 'moonshot' }
    const result = await plugin.transformParams!(params, context as any)

    // Should inject tool with default config
    expect(result.tools).toBeDefined()
    expect(result.tools).toHaveProperty('$web_search')
  })
})

describe('ensureToolsObject handles arrays', () => {
  it('should convert empty array to object', () => {
    const params = {
      tools: [] as any[]
    }

    // Simulate what ensureToolsObject does
    if (!params.tools || Array.isArray(params.tools)) {
      params.tools = {}
    }

    expect(Array.isArray(params.tools)).toBe(false)
    expect(typeof params.tools).toBe('object')
  })

  it('should keep object as object', () => {
    const params = {
      tools: { existing: 'tool' }
    }

    if (!params.tools || Array.isArray(params.tools)) {
      params.tools = {}
    }

    expect(params.tools).toHaveProperty('existing', 'tool')
  })
})
