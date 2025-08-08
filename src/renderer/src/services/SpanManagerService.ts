import { MessageStream } from '@anthropic-ai/sdk/resources/messages/messages'
import { loggerService } from '@logger'
import { SpanEntity, TokenUsage } from '@mcp-trace/trace-core'
import { cleanContext, endContext, getContext, startContext } from '@mcp-trace/trace-web'
import { Context, context, Span, SpanStatusCode, trace } from '@opentelemetry/api'
import { isAsyncIterable } from '@renderer/aiCore/middleware/utils'
import { db } from '@renderer/databases'
import { getEnableDeveloperMode } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { handleAsyncIterable } from '@renderer/trace/dataHandler/AsyncIterableHandler'
import { handleResult } from '@renderer/trace/dataHandler/CommonResultHandler'
import { handleMessageStream } from '@renderer/trace/dataHandler/MessageStreamHandler'
import { handleStream } from '@renderer/trace/dataHandler/StreamHandler'
import { EndSpanParams, ModelSpanEntity, StartSpanParams } from '@renderer/trace/types/ModelSpanEntity'
import { Model, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'
import { SdkRawChunk } from '@renderer/types/sdk'
import { Stream } from 'openai/streaming'

const logger = loggerService.withContext('SpanManagerService')

class SpanManagerService {
  private spanMap: Map<string, ModelSpanEntity[]> = new Map()

  getModelSpanEntity(topicId: string, modelName?: string) {
    const entities = this.spanMap.get(topicId)
    if (!entities) {
      const entity = new ModelSpanEntity(modelName)
      this.spanMap.set(topicId, [entity])
      return entity
    }
    let entity = entities.find((e) => e.getModelName() === modelName)
    if (!entity) {
      entity = new ModelSpanEntity(modelName)
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

    const ctx = this._updateContext(span, params.topicId)
    models?.forEach((model) => {
      this._addModelRootSpan({ ...params, name: `${model.name}.handleMessage`, modelName: model.name }, ctx)
    })
    return span
  }

  async restartTrace(message: Message, text?: string) {
    if (!getEnableDeveloperMode()) {
      return
    }

    if (!message.traceId) {
      return
    }

    await window.api.trace.bindTopic(message.topicId, message.traceId)

    const input = await this._getContentFromMessage(message, text)

    let _models
    if (message.role === 'user') {
      await window.api.trace.cleanHistory(message.topicId, message.traceId)

      const topic = await db.topics.get(message.topicId)
      _models = topic?.messages.filter((m) => m.role === 'assistant' && m.askId === message.id).map((m) => m.model)
    } else {
      _models = [message.model]
      await window.api.trace.cleanHistory(message.topicId, message.traceId || '', message.model?.name)
    }

    _models
      ?.filter((m) => !!m)
      .forEach((model) => {
        this._addModelRootSpan({ ...input, modelName: model.name, name: `${model.name}.resendMessage` })
      })

    const modelName = message.role !== 'user' ? _models[0]?.name : undefined
    window.api.trace.openWindow(message.topicId, message.traceId, false, modelName)
  }

  async appendTrace(message: Message, model: Model) {
    if (!getEnableDeveloperMode()) {
      return
    }
    if (!message.traceId) {
      return
    }

    await window.api.trace.cleanHistory(message.topicId, message.traceId, model.name)

    const input = await this._getContentFromMessage(message)
    await window.api.trace.bindTopic(message.topicId, message.traceId)
    this._addModelRootSpan({ ...input, name: `${model.name}.appendMessage`, modelName: model.name })
    window.api.trace.openWindow(message.topicId, message.traceId, false, model.name)
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

  private _addModelRootSpan(params: StartSpanParams, ctx?: Context) {
    const entity = this.getModelSpanEntity(params.topicId, params.modelName)
    const rootSpan = webTracer.startSpan(
      `${params.name}`,
      {
        attributes: {
          inputs: JSON.stringify(params.inputs || {}),
          modelName: params.modelName,
          tags: 'ModelHandle'
        }
      },
      ctx
    )
    entity.addSpan(rootSpan, true)
    const traceId = params.inputs?.traceId || rootSpan.spanContext().traceId
    return this._updateContext(rootSpan, params.topicId, traceId)
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
    const entity = this.getModelSpanEntity(params.topicId, params.modelName)
    let parentSpan = entity.getSpanById(params.parentSpanId)
    if (!parentSpan) {
      parentSpan = this.getCurrentSpan(params.topicId, params.modelName)
    }

    const parentCtx = parentSpan ? trace.setSpan(context.active(), parentSpan) : getContext(params.topicId)
    const span = webTracer.startSpan(
      params.name || 'root',
      {
        attributes: {
          inputs: JSON.stringify(params.inputs || {}),
          tags: params.tag || '',
          modelName: params.modelName
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
    const entity = this.getModelSpanEntity(params.topicId, params.modelName)
    const span = params.span || entity.getCurrentSpan(params.modelName)
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
    if (entity.removeSpan(span)) {
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

  getCurrentSpan(topicId: string, modelName?: string, isRoot = false): Span | undefined {
    let entity = this.getModelSpanEntity(topicId, modelName)
    let span = isRoot ? entity.getRoot() : entity.getCurrentSpan(modelName)
    if (!span && modelName) {
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
    modelName: params.modelName
  })
  try {
    const result = fn(...args)
    if (result instanceof Promise) {
      return result
        .then((data) => {
          if (!data || typeof data !== 'object') {
            endSpan({ topicId: params.topicId, outputs: data, span, modelName: params.modelName })
            return data
          }

          if (data instanceof Stream) {
            return handleStream(data, span, params.topicId, params.modelName)
          } else if (data instanceof MessageStream) {
            return handleMessageStream(data, span, params.topicId, params.modelName)
          } else if (isAsyncIterable<SdkRawChunk>(data)) {
            return handleAsyncIterable(data, span, params.topicId, params.modelName)
          } else {
            return handleResult(data, span, params.topicId, params.modelName)
          }
        })
        .catch((err) => {
          endSpan({ topicId: params.topicId, error: err, span, modelName: params.modelName })
          throw err
        }) as ReturnType<F>
    } else {
      endSpan({ topicId: params.topicId, outputs: result, span, modelName: params.modelName })
      return result
    }
  } catch (err) {
    endSpan({ topicId: params.topicId, error: err as Error, span, modelName: params.modelName })
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
export const restartTrace = spanManagerService.restartTrace.bind(spanManagerService)

EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, ({ topicId, traceId }) => {
  window.api.trace.openWindow(topicId, traceId, false)
})
EventEmitter.on(EVENT_NAMES.CLEAR_MESSAGES, (topic: Topic) => {
  window.api.trace.cleanTopic(topic.id)
})
