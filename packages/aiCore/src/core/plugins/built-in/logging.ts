/**
 * 内置插件：日志记录
 * 记录AI调用的关键信息，支持性能监控和调试
 */
import { definePlugin } from '../index'
import type { AiRequestContext } from '../types'

export interface LoggingConfig {
  // 日志级别
  level?: 'debug' | 'info' | 'warn' | 'error'
  // 是否记录参数
  logParams?: boolean
  // 是否记录结果
  logResult?: boolean
  // 是否记录性能数据
  logPerformance?: boolean
  // 自定义日志函数
  logger?: (level: string, message: string, data?: any) => void
}

/**
 * 创建日志插件
 */
export function createLoggingPlugin(config: LoggingConfig = {}) {
  const { level = 'info', logParams = true, logResult = false, logPerformance = true, logger = console.log } = config

  const startTimes = new Map<string, number>()

  return definePlugin({
    name: 'built-in:logging',

    onRequestStart: (context: AiRequestContext) => {
      const requestId = context.requestId
      startTimes.set(requestId, Date.now())

      logger(level, `🚀 AI Request Started`, {
        requestId,
        providerId: context.providerId,
        modelId: context.modelId,
        originalParams: logParams ? context.originalParams : '[hidden]'
      })
    },

    onRequestEnd: (context: AiRequestContext, result: any) => {
      const requestId = context.requestId
      const startTime = startTimes.get(requestId)
      const duration = startTime ? Date.now() - startTime : undefined
      startTimes.delete(requestId)

      const logData: any = {
        requestId,
        providerId: context.providerId,
        modelId: context.modelId
      }

      if (logPerformance && duration) {
        logData.duration = `${duration}ms`
      }

      if (logResult) {
        logData.result = result
      }

      logger(level, `✅ AI Request Completed`, logData)
    },

    onError: (error: Error, context: AiRequestContext) => {
      const requestId = context.requestId
      const startTime = startTimes.get(requestId)
      const duration = startTime ? Date.now() - startTime : undefined
      startTimes.delete(requestId)

      logger('error', `❌ AI Request Failed`, {
        requestId,
        providerId: context.providerId,
        modelId: context.modelId,
        duration: duration ? `${duration}ms` : undefined,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      })
    }
  })
}
