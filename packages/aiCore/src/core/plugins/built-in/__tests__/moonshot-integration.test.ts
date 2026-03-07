// @ts-nocheck
import { describe, expect, it } from 'vitest'

import { PluginManager } from '../../manager'
import { createPromptToolUsePlugin } from '../toolUsePlugin/promptToolUsePlugin'
import { webSearchPlugin } from '../webSearchPlugin'

describe('Moonshot Integration Test', () => {
  it('should inject $web_search tool and pass through promptToolUsePlugin', async () => {
    // Step 1: Create webSearchPlugin with Moonshot config
    const searchPlugin = webSearchPlugin({ moonshot: true })

    // Step 2: Create promptToolUsePlugin
    const toolUsePlugin = createPromptToolUsePlugin({ enabled: true })

    // Step 3: Create PluginManager and add plugins
    const manager = new PluginManager([searchPlugin, toolUsePlugin])

    // Step 4: Initial params
    const initialParams = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search for Qwen3.5' }],
      tools: {} as Record<string, any>
    }

    // Step 5: Execute transformParams through PluginManager
    const context = {
      providerId: 'moonshot',
      originalParams: initialParams,
      requestId: 'test-request-1'
    }

    const result: any = await manager.executeTransformParams(initialParams, context)

    console.log('=== Integration Test Result ===')
    console.log('Result tools:', JSON.stringify(result.tools, null, 2))

    // Step 6: Verify tools are correctly transformed
    expect(result.tools).toBeDefined()
    expect(result.tools).toHaveProperty('$web_search')

    // Step 7: Verify tool keeps provider type in AI SDK params
    // Moonshot builtin_function will be injected at final request payload layer.
    const webSearchTool = result.tools!['$web_search']
    expect(webSearchTool).toMatchObject({
      type: 'provider',
      isBuiltin: true,
      definition: {
        type: 'builtin_function',
        function: { name: '$web_search' }
      }
    })

    // Step 8: Verify builtin tool is saved in context
    expect(context.builtinTools).toBeDefined()
    expect(context.builtinTools).toHaveProperty('$web_search')
    expect(context.builtinTools['$web_search'].isBuiltin).toBe(true)

    console.log('=== Test Passed ===')
    console.log('Tool definition sent to API:', JSON.stringify(result.tools, null, 2))
  })

  it('should handle empty tools array through plugin chain', async () => {
    const searchPlugin = webSearchPlugin({ moonshot: true })
    const toolUsePlugin = createPromptToolUsePlugin({ enabled: true })
    const manager = new PluginManager([searchPlugin, toolUsePlugin])

    const initialParams = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search' }],
      tools: [] as any[] // Empty array
    }

    const context = {
      providerId: 'moonshot',
      originalParams: initialParams,
      requestId: 'test-request-2'
    }

    const result: any = await manager.executeTransformParams(initialParams, context)

    console.log('=== Empty Array Test Result ===')
    console.log('Result tools:', JSON.stringify(result.tools, null, 2))

    // Verify tools is object, not array
    expect(Array.isArray(result.tools)).toBe(false)
    expect(result.tools).toHaveProperty('$web_search')
    expect(result.tools!['$web_search'].type).toBe('provider')

    console.log('=== Test Passed ===')
  })

  it('should not break other providers', async () => {
    const searchPlugin = webSearchPlugin({ openai: {} })
    const toolUsePlugin = createPromptToolUsePlugin({ enabled: true })
    const manager = new PluginManager([searchPlugin, toolUsePlugin])

    const initialParams = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: {} as Record<string, any>
    }

    const context = {
      providerId: 'openai',
      originalParams: initialParams,
      requestId: 'test-request-3'
    }

    const result: any = await manager.executeTransformParams(initialParams, context)

    console.log('=== OpenAI Test Result ===')
    console.log('Result tools:', JSON.stringify(result.tools, null, 2))

    // OpenAI should have web_search tool
    expect(result.tools).toBeDefined()
    expect(result.tools).toHaveProperty('web_search')

    console.log('=== Test Passed ===')
  })
})
