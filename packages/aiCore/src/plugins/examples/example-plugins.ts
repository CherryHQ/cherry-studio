import type { AiPlugin } from '../types'

/**
 * 【First 钩子示例】模型别名解析插件
 */
export const ModelAliasPlugin: AiPlugin = {
  name: 'model-alias',
  enforce: 'pre',

  async resolveModel(modelId) {
    const aliases: Record<string, string> = {
      gpt4: 'gpt-4-turbo-preview',
      claude: 'claude-3-sonnet-20240229',
      gemini: 'gemini-pro'
    }

    return aliases[modelId] || null
  }
}

/**
 * 【Sequential 钩子示例】参数验证和转换插件
 */
export const ParamsValidationPlugin: AiPlugin = {
  name: 'params-validation',

  async transformParams(params) {
    // 参数验证
    if (!params.messages || !Array.isArray(params.messages)) {
      throw new Error('Invalid messages parameter')
    }

    // 参数转换：添加默认配置
    return {
      ...params,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 4096,
      stream: params.stream ?? true
    }
  },

  async transformResult(result, context) {
    // 结果后处理：添加元数据
    return {
      ...result,
      metadata: {
        ...result.metadata,
        processedAt: new Date().toISOString(),
        provider: context.providerId,
        model: context.modelId
      }
    }
  }
}

/**
 * 【Parallel 钩子示例】日志记录插件
 */
export const LoggingPlugin: AiPlugin = {
  name: 'logging',

  async onRequestStart(context) {
    console.log(`🚀 AI请求开始: ${context.providerId}/${context.modelId}`, {
      requestId: context.requestId,
      timestamp: new Date().toISOString()
    })
  },

  async onRequestEnd(context, result) {
    const duration = Date.now() - context.startTime
    console.log(`✅ AI请求完成: ${context.requestId} (${duration}ms)`, {
      provider: context.providerId,
      model: context.modelId,
      hasResult: !!result
    })
  },

  async onError(error, context) {
    const duration = Date.now() - context.startTime
    console.error(`❌ AI请求失败: ${context.requestId} (${duration}ms)`, {
      provider: context.providerId,
      model: context.modelId,
      error: error.message,
      stack: error.stack
    })
  }
}

/**
 * 【Parallel 钩子示例】性能监控插件
 */
export const PerformancePlugin: AiPlugin = {
  name: 'performance',
  enforce: 'post',

  async onRequestEnd(context) {
    const duration = Date.now() - context.startTime

    // 记录性能指标
    const metrics = {
      requestId: context.requestId,
      provider: context.providerId,
      model: context.modelId,
      duration,
      timestamp: context.startTime,
      success: true
    }

    // 发送到监控系统（这里只是示例）
    // await sendMetrics(metrics)
    console.log('📊 性能指标:', metrics)
  },

  async onError(error, context) {
    const duration = Date.now() - context.startTime

    const metrics = {
      requestId: context.requestId,
      provider: context.providerId,
      model: context.modelId,
      duration,
      timestamp: context.startTime,
      success: false,
      errorType: error.constructor.name
    }

    console.log('📊 错误指标:', metrics)
  }
}

/**
 * 【Stream 钩子示例】内容过滤插件
 */
export const ContentFilterPlugin: AiPlugin = {
  name: 'content-filter',

  transformStream() {
    return () =>
      new TransformStream({
        transform(chunk, controller) {
          // 过滤敏感内容
          if (chunk.type === 'text-delta') {
            const filtered = chunk.textDelta.replace(/\b(敏感词|违禁词)\b/g, '***')
            controller.enqueue({
              ...chunk,
              textDelta: filtered
            })
          } else {
            controller.enqueue(chunk)
          }
        }
      })
  }
}

/**
 * 【First 钩子示例】模板加载插件
 */
export const TemplatePlugin: AiPlugin = {
  name: 'template-loader',

  async loadTemplate(templateName) {
    const templates: Record<string, any> = {
      chat: {
        systemPrompt: '你是一个有用的AI助手',
        temperature: 0.7
      },
      coding: {
        systemPrompt: '你是一个专业的编程助手，请提供清晰、高质量的代码',
        temperature: 0.3
      },
      creative: {
        systemPrompt: '你是一个创意写作助手，请发挥想象力',
        temperature: 0.9
      }
    }

    return templates[templateName] || null
  }
}

/**
 * 示例插件组合
 */
export const defaultPlugins: AiPlugin[] = [
  ModelAliasPlugin,
  TemplatePlugin,
  ParamsValidationPlugin,
  LoggingPlugin,
  PerformancePlugin,
  ContentFilterPlugin
]
