import { MessageStream } from '@anthropic-ai/sdk/resources/messages/messages'
import { Stream } from '@cherrystudio/openai/streaming'
import { loggerService } from '@logger'
import type { SpanEntity, TokenUsage } from '@mcp-trace/trace-core'
import { cleanContext, endContext, getContext, startContext } from '@mcp-trace/trace-web'
import type { Span } from '@opentelemetry/api'
import { context, SpanStatusCode, trace } from '@opentelemetry/api'
import { isAsyncIterable } from '@renderer/aiCore/legacy/middleware/utils'
import { db } from '@renderer/databases'
import { getEnableDeveloperMode } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { handleAsyncIterable } from '@renderer/trace/dataHandler/AsyncIterableHandler'
import { handleResult } from '@renderer/trace/dataHandler/CommonResultHandler'
import { handleMessageStream } from '@renderer/trace/dataHandler/MessageStreamHandler'
import { handleStream } from '@renderer/trace/dataHandler/StreamHandler'
import type { EndSpanParams, StartSpanParams } from '@renderer/trace/types/ModelSpanEntity'
import { ModelSpanEntity } from '@renderer/trace/types/ModelSpanEntity'
import type { Model, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'
import type { SdkRawChunk } from '@renderer/types/sdk'

const logger = loggerService.withContext('SpanManagerService')

class SpanManagerService {
  private spanMap: Map<string, ModelSpanEntity[]> = new Map()

  getModelSpanEntity(topicId: string, modelName?: string, assistantMsgId?: string): ModelSpanEntity {
    const entities = this.spanMap.get(topicId)
    if (!entities) {
      const entity = new ModelSpanEntity(modelName, assistantMsgId)
      this.spanMap.set(topicId, [entity])
      return entity
    }
    let entity = entities.find((e) => e.isCurrent(modelName, assistantMsgId))
    if (!entity) {
      entity = new ModelSpanEntity(modelName, assistantMsgId)
      entities.push(entity)
    }
    return entity
  }

  startTrace(params: StartSpanParams, models?: Model[]) {
    if (!getEnableDeveloperMode()) {
      return
    }

    const span = webTracer.startSpan(params.name || 'root', {
      root: true,
      attributes: {
        inputs: JSON.stringify(params.inputs || {}),
        models: JSON.stringify(models || [])
      }
    })

    const entity = this.getModelSpanEntity(params.topicId)
    entity.addSpan(span)
    const traceId = span.spanContext().traceId
    window.api.trace.bindTopic(params.topicId, traceId)

    return span
  }

  async restartTrace(message: Message, text?: string) {
    if (!getEnableDeveloperMode()) {
      return
    }

    if (!message.traceId) {
      return
    }

    const input = await this._getContentFromMessage(message, text)

    const span = webTracer.startSpan('resendMessage', {
      ...input,
      root: true
    })

    if (message.role === 'user') {
      await window.api.trace.cleanHistory(message.topicId, message.traceId)
    } else {
      await window.api.trace.cleanHistory(message.topicId, message.traceId || '', message.model?.name)
    }

    const entity = this.getModelSpanEntity(message.topicId)
    entity.addSpan(span)
    this._updateContext(span, message.topicId, message.traceId)
    await window.api.trace.bindTopic(message.topicId, message.traceId)

    const modelName = message.role !== 'user' ? message.model?.name : undefined
    window.api.trace.openWindow(message.topicId, message.traceId, false, modelName)
  }

  async appendMessageTrace(message: Message, model: Model) {
    if (!getEnableDeveloperMode()) {
      return
    }
    if (!message.traceId) {
      return
    }

    await window.api.trace.cleanHistory(message.topicId, message.traceId, model.name)

    const input = await this._getContentFromMessage(message)
    await window.api.trace.bindTopic(message.topicId, message.traceId)

    const span = webTracer.startSpan('appendMessage', {
      ...input,
      root: true
    })
    const entity = this.getModelSpanEntity(message.topicId)
    entity.addSpan(span)
    this._updateContext(span, message.topicId, message.traceId)

    window.api.trace.openWindow(message.topicId, message.traceId, false, model.name)
  }

  async appendTrace({ topicId, traceId, model }: { topicId: string; traceId: string; model: Model }) {
    if (!getEnableDeveloperMode()) {
      return
    }
    if (!traceId) {
      return
    }

    await window.api.trace.cleanHistory(topicId, traceId, model.name)

    // const input = await this._getContentFromMessage(message)
    await window.api.trace.bindTopic(topicId, traceId)

    // 不使用 _addModelRootSpan，直接创建简单的 span 来避免额外的模型层级
    const entity = this.getModelSpanEntity(topicId, model.name)
    const span = webTracer.startSpan('')
    span['_spanContext'].traceId = traceId
    entity.addSpan(span, true)
    this._updateContext(span, topicId, traceId)

    window.api.trace.openWindow(topicId, traceId, false, model.name)
  }

  private async _getContentFromMessage(message: Message, content?: string): Promise<StartSpanParams> {
    let _content = content
    if (!_content) {
      const blocks = await Promise.all(
        message.blocks.map(async (blockId) => {
          return await db.message_blocks.get(blockId)
        })
      )
      _content = blocks.find((data) => data?.type === MessageBlockType.MAIN_TEXT)?.content
    }
    return {
      topicId: message.topicId,
      inputs: {
        messageId: message.id,
        content: _content,
        askId: message.askId,
        traceId: message.traceId,
        tag: 'resendMessage'
      }
    }
  }

  private _updateContext(span: Span, topicId: string, traceId?: string) {
    window.api.trace.saveEntity({
      id: span.spanContext().spanId,
      traceId: traceId ? traceId : span.spanContext().traceId,
      topicId
    } as SpanEntity)
    if (traceId) {
      span['_spanContext'].traceId = traceId
    }

    const ctx = trace.setSpan(context.active(), span)
    startContext(topicId, ctx)
    return ctx
  }

  endTrace(params: EndSpanParams) {
    const entity = this.getModelSpanEntity(params.topicId)
    let span = entity.getCurrentSpan()
    const code = params.error ? SpanStatusCode.ERROR : SpanStatusCode.OK
    const message = params.error ? params.error.message : ''
    while (span) {
      if (params.outputs) {
        span.setAttributes({ outputs: params.outputs })
      }
      if (params.error) {
        span.recordException(params.error)
      }
      span.setStatus({ code, message })
      span.end()
      entity.removeSpan(span)
      span = entity.getCurrentSpan()
    }
    this.finishModelTrace(params.topicId)
    cleanContext(params.topicId)
    window.api.trace.saveData(params.topicId)
  }

  addSpan(params: StartSpanParams) {
    if (!getEnableDeveloperMode()) {
      return
    }
    const entity = this.getModelSpanEntity(params.topicId, params.modelName, params.assistantMsgId)
    let parentSpan = entity.getSpanById(params.parentSpanId)
    if (!parentSpan) {
      parentSpan = this.getCurrentSpan(params.topicId, params.modelName, params.assistantMsgId)
    }

    const parentCtx = parentSpan ? trace.setSpan(context.active(), parentSpan) : getContext(params.topicId)
    const span = webTracer.startSpan(
      params.name || 'root',
      {
        attributes: {
          inputs: JSON.stringify(params.inputs || {}),
          tags: params.tag || '',
          modelName: params.modelName,
          assistantMsgId: params.assistantMsgId || ''
        }
      },
      parentCtx
    )
    const ctx = trace.setSpan(getContext(params.topicId), span)
    entity.addSpan(span)
    startContext(params.topicId, ctx)
    return span
  }

  endSpan(params: EndSpanParams) {
    const entity = this.getModelSpanEntity(params.topicId, params.modelName, params.assistantMsgId)
    const span = params.span || entity.getCurrentSpan(params.modelName, params.assistantMsgId)
    if (params.modelEnded && params.modelName && params.outputs) {
      const rootEntity = this.getModelSpanEntity(params.topicId)
      const span = rootEntity?.getRootSpan()
      window.api.trace.addEndMessage(span?.spanContext().spanId || '', params.modelName, params.outputs)
    }
    if (params.modelEnded && params.error && params.modelName) {
      const rootEntity = this.getModelSpanEntity(params.topicId)
      rootEntity.addModelError(params.error)
    }
    if (!span) {
      logger.info(`No active span found for topicId: ${params.topicId}-modelName: ${params.modelName}.`)
      return
    }

    // remove span
    if (!entity.removeSpan(span) && params.modelName) {
      this.getModelSpanEntity(params.topicId).removeSpan(span)
    }

    const code = params.error ? SpanStatusCode.ERROR : SpanStatusCode.OK
    const message = params.error ? params.error.message : 'success'
    if (params.outputs) {
      span.setAttributes({ outputs: JSON.stringify(params.outputs || {}) })
    }
    if (params.error) {
      span.recordException(params.error)
    }
    span.setStatus({ code, message })
    span.end()
    endContext(params.topicId)
  }

  getCurrentSpan(topicId: string, modelName?: string, assistantMsgId?: string): Span | undefined {
    let entity = this.getModelSpanEntity(topicId, modelName, assistantMsgId)
    let span = entity.getCurrentSpan(modelName, assistantMsgId)
    if (!span && (modelName || assistantMsgId)) {
      entity = this.getModelSpanEntity(topicId)
      span = entity.getCurrentSpan()
    }
    return span
  }

  async addTokenUsage(topicId: string, prompt: number, completion: number) {
    const span = this.getCurrentSpan(topicId)
    const usage: TokenUsage = {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion
    }
    if (span) {
      window.api.trace.tokenUsage(span.spanContext().spanId, usage)
    }
  }

  async finishModelTrace(topicId: string) {
    this.spanMap.get(topicId)?.forEach((entity) => entity.finishSpan())
    this.spanMap.delete(topicId)
  }
}

/**
 * Wraps a function and executes it within a span, returning the function's result instead of the wrapped function.
 * @param fn The function to execute.
 * @param name The span name.
 * @param tags The span tags.
 * @param getTopicId Function to get topicId from arguments.
 * @returns The result of the executed function.
 */
export function withSpanResult<F extends (...args: any) => any>(
  fn: F,
  params: StartSpanParams,
  ...args: Parameters<F>
): ReturnType<F> {
  if (!params.topicId || params.topicId === '') {
    return fn(...args)
  }
  const span = addSpan({
    topicId: params.topicId,
    name: params.name,
    tag: params.tag,
    inputs: args,
    parentSpanId: params.parentSpanId,
    modelName: params.modelName,
    assistantMsgId: params.assistantMsgId
  })
  try {
    const result = fn(...args)
    if (result instanceof Promise) {
      return result
        .then((data) => {
          if (!data || typeof data !== 'object') {
            endSpan({ ...params, outputs: data, span })
            return data
          }

          if (data instanceof Stream) {
            return handleStream(data, span, params)
          } else if (data instanceof MessageStream) {
            return handleMessageStream(data, span, params)
          } else if (isAsyncIterable<SdkRawChunk>(data)) {
            return handleAsyncIterable(data, span, params)
          } else {
            return handleResult(data, span, params)
          }
        })
        .catch((err) => {
          endSpan({ ...params, error: err as Error, span })
          throw err
        }) as ReturnType<F>
    } else {
      endSpan({ ...params, outputs: result, span })
      return result
    }
  } catch (err) {
    endSpan({ ...params, error: err as Error, span })
    throw err
  }
}

export const spanManagerService = new SpanManagerService()
export const webTracer = trace.getTracer('CherryStudio', '1.0.0')
export const addSpan = spanManagerService.addSpan.bind(spanManagerService)
export const startTrace = spanManagerService.startTrace.bind(spanManagerService)
export const endTrace = spanManagerService.endTrace.bind(spanManagerService)
export const endSpan = spanManagerService.endSpan.bind(spanManagerService)
export const currentSpan = spanManagerService.getCurrentSpan.bind(spanManagerService)
export const addTokenUsage = spanManagerService.addTokenUsage.bind(spanManagerService)
export const pauseTrace = spanManagerService.finishModelTrace.bind(spanManagerService)
export const appendTrace = spanManagerService.appendTrace.bind(spanManagerService)
export const appendMessageTrace = spanManagerService.appendMessageTrace.bind(spanManagerService)
export const restartTrace = spanManagerService.restartTrace.bind(spanManagerService)

EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, ({ topicId, traceId }) => {
  window.api.trace.openWindow(topicId, traceId, false)
})
EventEmitter.on(EVENT_NAMES.CLEAR_MESSAGES, (topic: Topic) => {
  window.api.trace.cleanTopic(topic.id)
})
