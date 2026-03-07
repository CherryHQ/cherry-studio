import { describe, expect, it } from 'vitest'

import { createMockContext } from '../../../../__tests__'
import { PluginManager } from '../../manager'
import type { AiPlugin, StreamTextParams, StreamTextResult } from '../../types'
import { createPromptToolUsePlugin } from '../toolUsePlugin/promptToolUsePlugin'
import { webSearchPlugin } from '../webSearchPlugin'

type ToolLike = {
  type?: string
  isBuiltin?: boolean
  definition?: {
    type?: string
    function?: { name?: string }
  }
}

type ToolMap = Record<string, ToolLike>

describe('Moonshot Integration Test', () => {
  it('should inject $web_search tool and pass through promptToolUsePlugin', async () => {
    const searchPlugin = webSearchPlugin({ moonshot: true })
    const toolUsePlugin = createPromptToolUsePlugin({ enabled: true })
    const manager = new PluginManager<StreamTextParams, StreamTextResult>([
      searchPlugin as AiPlugin<StreamTextParams, StreamTextResult>,
      toolUsePlugin as AiPlugin<StreamTextParams, StreamTextResult>
    ])

    const initialParams: StreamTextParams = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search for Qwen3.5' }]
    }

    const context = createMockContext({
      providerId: 'moonshot',
      originalParams: initialParams,
      requestId: 'test-request-1'
    })

    const result = await manager.executeTransformParams(initialParams, context)
    const resultTools = (result.tools ?? {}) as ToolMap

    expect(resultTools).toHaveProperty('$web_search')

    const webSearchTool = resultTools.$web_search
    expect(webSearchTool).toMatchObject({
      type: 'provider',
      isBuiltin: true,
      definition: {
        type: 'builtin_function',
        function: { name: '$web_search' }
      }
    })

    const builtinTools = context.builtinTools as ToolMap | undefined
    expect(builtinTools).toBeDefined()
    expect(builtinTools).toHaveProperty('$web_search')
    expect(builtinTools?.$web_search?.isBuiltin).toBe(true)
  })

  it('should handle empty tools array through plugin chain', async () => {
    const searchPlugin = webSearchPlugin({ moonshot: true })
    const toolUsePlugin = createPromptToolUsePlugin({ enabled: true })
    const manager = new PluginManager<StreamTextParams, StreamTextResult>([
      searchPlugin as AiPlugin<StreamTextParams, StreamTextResult>,
      toolUsePlugin as AiPlugin<StreamTextParams, StreamTextResult>
    ])

    const initialParams = {
      model: 'kimi-k2-0711-preview',
      messages: [{ role: 'user', content: 'Search' }],
      tools: []
    } as unknown as StreamTextParams

    const context = createMockContext({
      providerId: 'moonshot',
      originalParams: initialParams,
      requestId: 'test-request-2'
    })

    const result = await manager.executeTransformParams(initialParams, context)
    expect(Array.isArray(result.tools)).toBe(false)
    expect(result.tools).toHaveProperty('$web_search')
    expect((result.tools as ToolMap).$web_search.type).toBe('provider')
  })

  it('should not break other providers', async () => {
    const searchPlugin = webSearchPlugin({ openai: {} })
    const toolUsePlugin = createPromptToolUsePlugin({ enabled: true })
    const manager = new PluginManager<StreamTextParams, StreamTextResult>([
      searchPlugin as AiPlugin<StreamTextParams, StreamTextResult>,
      toolUsePlugin as AiPlugin<StreamTextParams, StreamTextResult>
    ])

    const initialParams: StreamTextParams = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }]
    }

    const context = createMockContext({
      providerId: 'openai',
      originalParams: initialParams,
      requestId: 'test-request-3'
    })

    const result = await manager.executeTransformParams(initialParams, context)
    expect(result.tools).toBeDefined()
    expect(result.tools).toHaveProperty('web_search')
  })
})
