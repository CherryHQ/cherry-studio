import { openai } from '@ai-sdk/openai'
import { streamText } from 'ai'

import { PluginEnabledAiClient } from '../../clients/PluginEnabledAiClient'
import { createContext, PluginManager } from '../'
import { ContentFilterPlugin, LoggingPlugin } from './example-plugins'

/**
 * 使用 PluginEnabledAiClient 的推荐方式
 * 这是最简单直接的使用方法
 */
export async function exampleWithPluginEnabledClient() {
  console.log('=== 使用 PluginEnabledAiClient 示例 ===')

  // 1. 创建带插件的客户端 - 链式调用方式
  const client = PluginEnabledAiClient.create('openai-compatible', {
    name: 'openai',
    baseURL: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY || 'sk-test'
  })
    .use(LoggingPlugin)
    .use(ContentFilterPlugin)

  // 2. 或者在创建时传入插件（也可以这样使用）
  // const clientWithPlugins = PluginEnabledAiClient.create(
  //   'openai-compatible',
  //   {
  //     name: 'openai',
  //     baseURL: 'https://api.openai.com/v1',
  //     apiKey: process.env.OPENAI_API_KEY || 'sk-test'
  //   },
  //   [LoggingPlugin, ContentFilterPlugin]
  // )

  // 3. 查看插件统计信息
  console.log('插件统计:', client.getPluginStats())

  try {
    // 4. 使用客户端进行 AI 调用（插件会自动生效）
    console.log('开始生成文本...')
    const result = await client.generateText('gpt-4', {
      messages: [{ role: 'user', content: 'Hello, world!' }],
      temperature: 0.7
    })

    console.log('生成的文本:', result.text)

    // 5. 流式调用（支持流转换器）
    console.log('开始流式生成...')
    const streamResult = await client.streamText('gpt-4', {
      messages: [{ role: 'user', content: 'Tell me a short story about AI' }]
    })

    console.log('开始流式响应...')
    for await (const textPart of streamResult.textStream) {
      process.stdout.write(textPart)
    }
    console.log('\n流式响应完成')

    return result
  } catch (error) {
    console.error('调用失败:', error)
    throw error
  }
}

/**
 * 创建 OpenAI Compatible 客户端的示例
 */
export function exampleOpenAICompatible() {
  console.log('=== OpenAI Compatible 示例 ===')

  // Ollama 示例
  const ollama = PluginEnabledAiClient.createOpenAICompatible(
    {
      name: 'ollama',
      baseURL: 'http://localhost:11434/v1'
    },
    [LoggingPlugin]
  )

  // LM Studio 示例
  const lmStudio = PluginEnabledAiClient.createOpenAICompatible({
    name: 'lm-studio',
    baseURL: 'http://localhost:1234/v1'
  }).use(ContentFilterPlugin)

  console.log('Ollama 插件统计:', ollama.getPluginStats())
  console.log('LM Studio 插件统计:', lmStudio.getPluginStats())

  return { ollama, lmStudio }
}

/**
 * 动态插件管理示例
 */
export function exampleDynamicPlugins() {
  console.log('=== 动态插件管理示例 ===')

  const client = PluginEnabledAiClient.create('openai-compatible', {
    name: 'openai',
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'your-api-key'
  })

  console.log('初始状态:', client.getPluginStats())

  // 动态添加插件
  client.use(LoggingPlugin)
  console.log('添加 LoggingPlugin 后:', client.getPluginStats())

  client.usePlugins([ContentFilterPlugin])
  console.log('添加 ContentFilterPlugin 后:', client.getPluginStats())

  // 移除插件
  client.removePlugin('content-filter')
  console.log('移除 content-filter 后:', client.getPluginStats())

  return client
}

/**
 * 完整的低级 API 示例（原有的 example-usage.ts 的方式）
 * 这种方式适合需要精细控制插件生命周期的场景
 */
export async function exampleLowLevelApi() {
  console.log('=== 低级 API 示例 ===')

  // 1. 创建插件管理器
  const pluginManager = new PluginManager([LoggingPlugin, ContentFilterPlugin])

  // 2. 创建请求上下文
  const context = createContext('openai', 'gpt-4', {
    messages: [{ role: 'user', content: 'Hello!' }]
  })

  try {
    // 3. 触发请求开始事件
    await pluginManager.executeParallel('onRequestStart', context)

    // 4. 解析模型别名
    const resolvedModel = await pluginManager.executeFirst('resolveModel', 'gpt-4', context)
    console.log('Resolved model:', resolvedModel || 'gpt-4')

    // 5. 转换请求参数
    const params = {
      messages: [{ role: 'user' as const, content: 'Hello, AI!' }],
      temperature: 0.7
    }
    const transformedParams = await pluginManager.executeSequential('transformParams', params, context)

    // 6. 收集流转换器（关键：AI SDK 原生支持数组！）
    const streamTransforms = pluginManager.collectStreamTransforms()

    // 7. 调用 AI SDK，直接传入转换器工厂数组
    const result = await streamText({
      model: openai('gpt-4'),
      ...transformedParams,
      experimental_transform: streamTransforms // 直接传入工厂函数数组
    })

    // 8. 处理结果
    let fullText = ''
    for await (const textPart of result.textStream) {
      fullText += textPart
      console.log('Streaming:', textPart)
    }

    // 9. 转换最终结果
    const finalResult = { text: fullText, usage: await result.usage }
    const transformedResult = await pluginManager.executeSequential('transformResult', finalResult, context)

    // 10. 触发完成事件
    await pluginManager.executeParallel('onRequestEnd', context, transformedResult)

    return transformedResult
  } catch (error) {
    // 11. 触发错误事件
    await pluginManager.executeParallel('onError', context, undefined, error as Error)
    throw error
  }
}

/**
 * 流转换器数组的其他使用方式
 */
export function demonstrateStreamTransforms() {
  console.log('=== 流转换器示例 ===')

  const pluginManager = new PluginManager([
    ContentFilterPlugin,
    {
      name: 'text-replacer',
      transformStream() {
        return () =>
          new TransformStream({
            transform(chunk, controller) {
              if (chunk.type === 'text-delta') {
                const replaced = chunk.textDelta.replace(/hello/gi, 'hi')
                controller.enqueue({ ...chunk, textDelta: replaced })
              } else {
                controller.enqueue(chunk)
              }
            }
          })
      }
    }
  ])

  // 获取所有流转换器
  const transforms = pluginManager.collectStreamTransforms()
  console.log(`收集到 ${transforms.length} 个流转换器`)

  // 可以单独使用每个转换器
  transforms.forEach((factory, index) => {
    console.log(`转换器 ${index + 1} 已准备就绪`)
    const transform = factory({ stopStream: () => {} })
    console.log('Transform created:', transform)
  })

  return transforms
}

/**
 * 运行所有示例
 */
export async function runAllExamples() {
  console.log('🚀 开始运行所有示例...\n')

  try {
    // 1. PluginEnabledAiClient 示例（推荐）
    await exampleWithPluginEnabledClient()
    console.log('✅ PluginEnabledAiClient 示例完成\n')

    // 2. OpenAI Compatible 示例
    exampleOpenAICompatible()
    console.log('✅ OpenAI Compatible 示例完成\n')

    // 3. 动态插件管理示例
    exampleDynamicPlugins()
    console.log('✅ 动态插件管理示例完成\n')

    // 4. 流转换器示例
    demonstrateStreamTransforms()
    console.log('✅ 流转换器示例完成\n')

    // 5. 低级 API 示例
    // await exampleLowLevelApi()
    console.log('✅ 低级 API 示例完成\n')

    console.log('🎉 所有示例运行完成！')
  } catch (error) {
    console.error('❌ 示例运行失败:', error)
  }
}
