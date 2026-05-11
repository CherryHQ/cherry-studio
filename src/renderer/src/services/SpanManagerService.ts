import { MessageStream } from '@anthropic-ai/sdk/resources/messages/messages'
import { Stream } from '@cherrystudio/openai/streaming'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { endContext, getContext, startContext } from '@mcp-trace/trace-web'
import type { Span } from '@opentelemetry/api'
import { context, SpanStatusCode, trace } from '@opentelemetry/api'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { handleResult } from '@renderer/trace/dataHandler/CommonResultHandler'
import { handleMessageStream } from '@renderer/trace/dataHandler/MessageStreamHandler'
import { handleStream } from '@renderer/trace/dataHandler/StreamHandler'
import type { EndSpanParams, StartSpanParams } from '@renderer/trace/types/ModelSpanEntity'
import { ModelSpanEntity } from '@renderer/trace/types/ModelSpanEntity'
import type { Topic } from '@renderer/types'

const logger = loggerService.withContext('SpanManagerService')

// LRU cap on the per-topic span map. Dev mode is the only path that ever
// populates this (`addSpan` early-returns when dev mode is off), but
// `finishModelTrace` is only called from a couple of selection-window
// flows — the main chat path has no cleanup hook, so without a cap the
// map grows unbounded across a dev session.
const MAX_TRACKED_TOPICS = 50

class SpanManagerService {
  // Map preserves insertion order; we evict the least-recently-touched
  // entry when we exceed MAX_TRACKED_TOPICS. Every `getModelSpanEntity`
  // call re-inserts the key so frequently-touched topics stay hot.
  private spanMap: Map<string, ModelSpanEntity[]> = new Map()

  async getEnableDeveloperMode() {
    return await preferenceService.get('app.developer_mode.enabled')
  }

  private touch(topicId: string, entities: ModelSpanEntity[]) {
    this.spanMap.delete(topicId)
    this.spanMap.set(topicId, entities)
  }

  private evictIfFull() {
    if (this.spanMap.size <= MAX_TRACKED_TOPICS) return
    const oldest = this.spanMap.keys().next().value
    if (oldest === undefined) return
    this.spanMap.delete(oldest)
  }

  getModelSpanEntity(topicId: string, modelName?: string) {
    const entities = this.spanMap.get(topicId)
    if (!entities) {
      const entity = new ModelSpanEntity(modelName)
      this.spanMap.set(topicId, [entity])
      this.evictIfFull()
      return entity
    }
    this.touch(topicId, entities)
    let entity = entities.find((e) => e.getModelName() === modelName)
    if (!entity) {
      entity = new ModelSpanEntity(modelName)
      entities.push(entity)
    }
    return entity
  }

  async addSpan(params: StartSpanParams) {
    if (!(await this.getEnableDeveloperMode())) {
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
      void window.api.trace.addEndMessage(span?.spanContext().spanId || '', params.modelName, params.outputs)
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
export async function withSpanResult<F extends (...args: any) => any>(
  fn: F,
  params: StartSpanParams,
  ...args: Parameters<F>
): Promise<ReturnType<F>> {
  if (!params.topicId || params.topicId === '') {
    return fn(...args)
  }
  const span = await addSpan({
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

const spanManagerService = new SpanManagerService()
const webTracer = trace.getTracer('CherryStudio', '1.0.0')
export const addSpan = spanManagerService.addSpan.bind(spanManagerService)
export const endSpan = spanManagerService.endSpan.bind(spanManagerService)
export const currentSpan = spanManagerService.getCurrentSpan.bind(spanManagerService)
export const pauseTrace = spanManagerService.finishModelTrace.bind(spanManagerService)

EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, ({ topicId, traceId }) => {
  void window.api.trace.openWindow(topicId, traceId, false)
})
EventEmitter.on(EVENT_NAMES.CLEAR_MESSAGES, (topic: Topic) => {
  // Drop the local spanMap entry too — `cleanTopic` only wipes the
  // backend, leaving renderer-side entities dangling otherwise.
  void spanManagerService.finishModelTrace(topic.id)
  void window.api.trace.cleanTopic(topic.id)
})
