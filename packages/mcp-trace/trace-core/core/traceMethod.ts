import 'reflect-metadata'

import { SpanStatusCode, trace } from '@opentelemetry/api'
import { context as traceContext } from '@opentelemetry/api'

import { defaultConfig } from '../types/config'

export interface SpanDecoratorOptions {
  spanName?: string
  traceName?: string
  tag?: string
}

export function TraceMethod(traced: SpanDecoratorOptions) {
  return function (target: any, propertyKey?: any, descriptor?: PropertyDescriptor | undefined) {
    // 兼容静态方法装饰器只传2个参数的情况
    if (!descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(target, propertyKey)
    }
    if (!descriptor || typeof descriptor.value !== 'function') {
      throw new Error('TraceMethod can only be applied to methods.')
    }

    const originalMethod = descriptor.value
    const traceName = traced.traceName || defaultConfig.defaultTracerName || 'default'
    const tracer = trace.getTracer(traceName)

    descriptor.value = function (...args: any[]) {
      const name = traced.spanName || propertyKey
      return tracer.startActiveSpan(name, async (span) => {
        try {
          span.setAttribute('inputs', convertToString(args))
          span.setAttribute('tags', traced.tag || '')
          const result = await originalMethod.apply(this, args)
          span.setAttribute('outputs', convertToString(result))
          span.setStatus({ code: SpanStatusCode.OK })
          return result
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message
          })
          span.recordException(err)
          throw error
        } finally {
          span.end()
        }
      })
    }
    return descriptor
  }
}

export function TraceProperty(traced: SpanDecoratorOptions) {
  return (target: any, propertyKey: string, descriptor?: PropertyDescriptor) => {
    // 处理箭头函数类属性
    const traceName = traced.traceName || defaultConfig.defaultTracerName || 'default'
    const tracer = trace.getTracer(traceName)
    const name = traced.spanName || propertyKey

    if (!descriptor) {
      const originalValue = target[propertyKey]

      Object.defineProperty(target, propertyKey, {
        value: async function (...args: any[]) {
          const span = tracer.startSpan(name)
          try {
            span.setAttribute('inputs', convertToString(args))
            span.setAttribute('tags', traced.tag || '')
            const result = await originalValue.apply(this, args)
            span.setAttribute('outputs', convertToString(result))
            return result
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error))
            span.recordException(err)
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
            throw error
          } finally {
            span.end()
          }
        },
        configurable: true,
        writable: true
      })
      return
    }

    // 标准方法装饰器逻辑
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const span = tracer.startSpan(name)
      try {
        span.setAttribute('inputs', convertToString(args))
        span.setAttribute('tags', traced.tag || '')
        const result = await originalMethod.apply(this, args)
        span.setAttribute('outputs', convertToString(result))
        return result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        span.recordException(err)
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
        throw error
      } finally {
        span.end()
      }
    }
  }
}

export function withSpanFunc<F extends (...args: any[]) => any>(
  name: string,
  tag: string,
  fn: F,
  args: Parameters<F>
): ReturnType<F> {
  const traceName = defaultConfig.defaultTracerName || 'default'
  const tracer = trace.getTracer(traceName)
  const _name = name || fn.name || 'anonymousFunction'
  return traceContext.with(traceContext.active(), () =>
    tracer.startActiveSpan(
      _name,
      {
        attributes: {
          tags: tag || '',
          inputs: JSON.stringify(args)
        }
      },
      (span) => {
        // 在这里调用原始函数
        const result = fn(...args)
        if (result instanceof Promise) {
          return result
            .then((res) => {
              span.setStatus({ code: SpanStatusCode.OK })
              span.setAttribute('outputs', convertToString(res))
              return res
            })
            .catch((error) => {
              const err = error instanceof Error ? error : new Error(String(error))
              span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
              span.recordException(err)
              throw error
            })
            .finally(() => span.end())
        } else {
          span.setStatus({ code: SpanStatusCode.OK })
          span.setAttribute('outputs', convertToString(result))
          span.end()
        }
        return result
      }
    )
  )
}

function convertToString(args: any | any[]): string | boolean | number {
  if (typeof args === 'string' || typeof args === 'boolean' || typeof args === 'number') {
    return args
  }
  return JSON.stringify(args)
}
