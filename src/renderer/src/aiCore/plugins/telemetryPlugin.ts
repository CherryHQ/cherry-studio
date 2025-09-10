/**
 * Telemetry Plugin for AI SDK Integration
 *
 * 在 transformParams 钩子中注入 experimental_telemetry 参数，
 * 实现 AI SDK trace 与现有手动 trace 系统的统一
 * 集成 AiSdkSpanAdapter 将 AI SDK trace 数据转换为现有格式
 */

import { definePlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { Context, context as otelContext, Span, SpanContext, trace, Tracer } from '@opentelemetry/api'
import { currentSpan } from '@renderer/services/SpanManagerService'
import { webTraceService } from '@renderer/services/WebTraceService'
import { Assistant } from '@renderer/types'

import { AiSdkSpanAdapter } from '../trace/AiSdkSpanAdapter'

const logger = loggerService.withContext('TelemetryPlugin')

export interface TelemetryPluginConfig {
  enabled?: boolean
  recordInputs?: boolean
  recordOutputs?: boolean
  topicId: string
  assistant: Assistant
}

/**
 * 自定义 Tracer，集成适配器转换逻辑
 */
class AdapterTracer {
  private originalTracer: Tracer
  private topicId?: string
  private modelName?: string
  private parentSpanContext?: SpanContext
  private cachedParentContext?: Context

  constructor(originalTracer: Tracer, topicId?: string, modelName?: string, parentSpanContext?: SpanContext) {
    this.originalTracer = originalTracer
    this.topicId = topicId
    this.modelName = modelName
    this.parentSpanContext = parentSpanContext
    // 预构建一个包含父 SpanContext 的 Context，便于复用
    try {
      this.cachedParentContext = this.parentSpanContext
        ? trace.setSpanContext(otelContext.active(), this.parentSpanContext)
        : undefined
    } catch {
      this.cachedParentContext = undefined
    }

    logger.info('AdapterTracer created with parent context info', {
      topicId,
      modelName,
      parentTraceId: this.parentSpanContext?.traceId,
      parentSpanId: this.parentSpanContext?.spanId,
      hasOriginalTracer: !!originalTracer
    })
  }

  startActiveSpan<F extends (span: Span) => any>(name: string, fn: F): ReturnType<F>
  startActiveSpan<F extends (span: Span) => any>(name: string, options: any, fn: F): ReturnType<F>
  startActiveSpan<F extends (span: Span) => any>(name: string, options: any, context: any, fn: F): ReturnType<F>
  startActiveSpan<F extends (span: Span) => any>(name: string, arg2?: any, arg3?: any, arg4?: any): ReturnType<F> {
    logger.info('AdapterTracer.startActiveSpan called', {
      spanName: name,
      topicId: this.topicId,
      modelName: this.modelName,
      argCount: arguments.length
    })

    // 包装函数来添加span转换逻辑
    const wrapFunction = (originalFn: F, span: Span): F => {
      const wrappedFn = ((passedSpan: Span) => {
        // 注入父子关系属性（兜底重建层级用）
        try {
          if (this.parentSpanContext) {
            passedSpan.setAttribute('trace.parentSpanId', this.parentSpanContext.spanId)
            passedSpan.setAttribute('trace.parentTraceId', this.parentSpanContext.traceId)
          }
          if (this.topicId) {
            passedSpan.setAttribute('trace.topicId', this.topicId)
          }
        } catch (e) {
          logger.debug('Failed to set trace parent attributes in startActiveSpan', e as Error)
        }
        // 包装span的end方法
        const originalEnd = span.end.bind(span)
        span.end = (endTime?: any) => {
          logger.info('AI SDK span.end() called in startActiveSpan - about to convert span', {
            spanName: name,
            spanId: span.spanContext().spanId,
            traceId: span.spanContext().traceId,
            topicId: this.topicId,
            modelName: this.modelName
          })

          // 调用原始 end 方法
          originalEnd(endTime)

          // 转换并保存 span 数据
          try {
            logger.info('Converting AI SDK span to SpanEntity (from startActiveSpan)', {
              spanName: name,
              spanId: span.spanContext().spanId,
              traceId: span.spanContext().traceId,
              topicId: this.topicId,
              modelName: this.modelName
            })
            logger.info('span', span)
            const spanEntity = AiSdkSpanAdapter.convertToSpanEntity({
              span,
              topicId: this.topicId,
              modelName: this.modelName
            })

            // 保存转换后的数据
            window.api.trace.saveEntity(spanEntity)

            logger.info('AI SDK span converted and saved successfully (from startActiveSpan)', {
              spanName: name,
              spanId: span.spanContext().spanId,
              traceId: span.spanContext().traceId,
              topicId: this.topicId,
              modelName: this.modelName,
              hasUsage: !!spanEntity.usage,
              usage: spanEntity.usage
            })
          } catch (error) {
            logger.error('Failed to convert AI SDK span (from startActiveSpan)', error as Error, {
              spanName: name,
              spanId: span.spanContext().spanId,
              traceId: span.spanContext().traceId,
              topicId: this.topicId,
              modelName: this.modelName
            })
          }
        }

        return originalFn(passedSpan)
      }) as F
      return wrappedFn
    }

    // 创建包含父 SpanContext 的上下文（如果有的话）
    const createContextWithParent = () => {
      if (this.cachedParentContext) {
        return this.cachedParentContext
      }
      if (this.parentSpanContext) {
        try {
          const ctx = trace.setSpanContext(otelContext.active(), this.parentSpanContext)
          logger.info('Created active context with parent SpanContext for startActiveSpan', {
            spanName: name,
            parentTraceId: this.parentSpanContext.traceId,
            parentSpanId: this.parentSpanContext.spanId,
            topicId: this.topicId
          })
          return ctx
        } catch (error) {
          logger.warn('Failed to create context with parent SpanContext in startActiveSpan', error as Error)
        }
      }
      return otelContext.active()
    }

    // 根据参数数量确定调用方式，注入包含mainTraceId的上下文
    if (typeof arg2 === 'function') {
      return this.originalTracer.startActiveSpan(name, {}, createContextWithParent(), (span: Span) => {
        return wrapFunction(arg2, span)(span)
      })
    } else if (typeof arg3 === 'function') {
      return this.originalTracer.startActiveSpan(name, arg2, createContextWithParent(), (span: Span) => {
        return wrapFunction(arg3, span)(span)
      })
    } else if (typeof arg4 === 'function') {
      // 如果调用方提供了 context，则保留以维护嵌套关系；否则回退到父上下文
      const ctx = arg3 ?? createContextWithParent()
      return this.originalTracer.startActiveSpan(name, arg2, ctx, (span: Span) => {
        return wrapFunction(arg4, span)(span)
      })
    } else {
      throw new Error('Invalid arguments for startActiveSpan')
    }
  }
}

export function createTelemetryPlugin(config: TelemetryPluginConfig) {
  const { enabled = true, recordInputs = true, recordOutputs = true, topicId } = config

  return definePlugin({
    name: 'telemetryPlugin',
    enforce: 'pre', // 在其他插件之前执行，确保 telemetry 配置被正确注入

    transformParams: (params, context) => {
      if (!enabled) {
        return params
      }

      // 获取共享的 tracer
      const originalTracer = webTraceService.getTracer()
      if (!originalTracer) {
        logger.warn('No tracer available from WebTraceService')
        return params
      }

      // 获取topicId和modelName
      const effectiveTopicId = context.topicId || topicId
      // 使用与父span创建时一致的modelName - 应该是完整的modelId
      const modelName = config.assistant.model?.name || context.modelId

      // 获取当前活跃的 span，确保 AI SDK spans 与手动 spans 在同一个 trace 中
      let parentSpan: Span | undefined = undefined
      let parentSpanContext: SpanContext | undefined = undefined

      // 只有在有topicId时才尝试查找父span
      if (effectiveTopicId) {
        try {
          // 从 SpanManagerService 获取当前的 span
          logger.info('Attempting to find parent span', {
            topicId: effectiveTopicId,
            requestId: context.requestId,
            modelName: modelName,
            contextModelId: context.modelId,
            providerId: context.providerId
          })

          parentSpan = currentSpan(effectiveTopicId, modelName)
          if (parentSpan) {
            // 直接使用父 span 的 SpanContext，避免手动拼装字段遗漏
            parentSpanContext = parentSpan.spanContext()
            logger.info('Found active parent span for AI SDK', {
              parentSpanId: parentSpanContext.spanId,
              parentTraceId: parentSpanContext.traceId,
              topicId: effectiveTopicId,
              requestId: context.requestId,
              modelName: modelName
            })
          } else {
            logger.warn('No active parent span found in SpanManagerService', {
              topicId: effectiveTopicId,
              requestId: context.requestId,
              modelId: context.modelId,
              modelName: modelName,
              providerId: context.providerId,
              // 更详细的调试信息
              searchedModelName: modelName,
              contextModelId: context.modelId,
              isAnalyzing: context.isAnalyzing
            })
          }
        } catch (error) {
          logger.error('Error getting current span from SpanManagerService', error as Error, {
            topicId: effectiveTopicId,
            requestId: context.requestId,
            modelName: modelName
          })
        }
      } else {
        logger.debug('No topicId provided, skipping parent span lookup', {
          requestId: context.requestId,
          contextTopicId: context.topicId,
          configTopicId: topicId,
          modelName: modelName
        })
      }

      // 创建适配器包装的 tracer，传入获取到的父 SpanContext
      const adapterTracer = new AdapterTracer(originalTracer, effectiveTopicId, modelName, parentSpanContext)

      // 注入 AI SDK telemetry 配置
      const telemetryConfig = {
        isEnabled: true,
        recordInputs,
        recordOutputs,
        tracer: adapterTracer, // 使用包装后的 tracer
        functionId: `ai-request-${context.requestId}`,
        metadata: {
          providerId: context.providerId,
          modelId: context.modelId,
          topicId: effectiveTopicId,
          requestId: context.requestId,
          modelName: modelName,
          // 确保topicId也作为标准属性传递
          'trace.topicId': effectiveTopicId,
          'trace.modelName': modelName,
          // 添加父span信息用于调试
          parentSpanId: parentSpanContext?.spanId,
          parentTraceId: parentSpanContext?.traceId
        }
      }

      // 如果有父span，尝试在telemetry配置中设置父上下文
      if (parentSpan) {
        try {
          // 设置活跃上下文，确保 AI SDK spans 在正确的 trace 上下文中创建
          const activeContext = trace.setSpan(otelContext.active(), parentSpan)

          // 更新全局上下文
          otelContext.with(activeContext, () => {
            logger.debug('Updated active context with parent span')
          })

          logger.info('Set parent context for AI SDK spans', {
            parentSpanId: parentSpanContext?.spanId,
            parentTraceId: parentSpanContext?.traceId,
            hasActiveContext: !!activeContext,
            hasParentSpan: !!parentSpan
          })
        } catch (error) {
          logger.warn('Failed to set parent context in telemetry config', error as Error)
        }
      }

      logger.info('Injecting AI SDK telemetry config with adapter', {
        requestId: context.requestId,
        topicId: effectiveTopicId,
        modelId: context.modelId,
        modelName: modelName,
        hasParentSpan: !!parentSpan,
        parentSpanId: parentSpanContext?.spanId,
        parentTraceId: parentSpanContext?.traceId,
        functionId: telemetryConfig.functionId,
        hasTracer: !!telemetryConfig.tracer,
        tracerType: telemetryConfig.tracer?.constructor?.name || 'unknown'
      })

      return {
        ...params,
        experimental_telemetry: telemetryConfig
      }
    }
  })
}

// 默认导出便于使用
export default createTelemetryPlugin
