/**
 * AI SDK Span Adapter
 *
 * Converts AI SDK telemetry data into the existing SpanEntity format.
 * Note the AI SDK hierarchy: ai.xxx is one level, ai.xxx.xxx is a child of that level.
 */

import { loggerService } from '@logger'
import type { SpanEntity, TokenUsage } from '@mcp-trace/trace-core'
import type { Span } from '@opentelemetry/api'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'

const logger = loggerService.withContext('AiSdkSpanAdapter')

export interface AiSdkSpanData {
  span: Span
  topicId?: string
  modelName?: string
}

// Extended interface for accessing the span's internal data.
interface SpanWithInternals extends Span {
  _spanProcessor?: any
  _attributes?: Record<string, any>
  _events?: any[]
  name?: string
  startTime?: [number, number]
  endTime?: [number, number] | null
  status?: { code: SpanStatusCode; message?: string }
  kind?: SpanKind
  ended?: boolean
  /** OTel SDK v2 ReadableSpan parent. (v1's `parentSpanId` string was removed.) */
  parentSpanContext?: { spanId?: string }
  links?: any[]
}

export class AiSdkSpanAdapter {
  /**
   * Convert an AI SDK span into the SpanEntity format.
   */
  static convertToSpanEntity(spanData: AiSdkSpanData): SpanEntity {
    const { span, topicId, modelName } = spanData
    const spanContext = span.spanContext()

    // Read span data via the various internal accessors the SDK may expose.
    const spanWithInternals = span as SpanWithInternals
    let attributes: Record<string, any> = {}
    let events: any[] = []
    let spanName = 'unknown'
    let spanStatus = { code: SpanStatusCode.UNSET }
    let spanKind = SpanKind.INTERNAL
    let startTime: [number, number] = [0, 0]
    let endTime: [number, number] | null = null
    let ended = false
    let parentSpanId = ''
    let links: any[] = []

    // Resolve span attributes from whichever internal accessor the SDK exposes.
    if (spanWithInternals._attributes) {
      attributes = spanWithInternals._attributes
    } else if (typeof (span as any).getAttributes === 'function') {
      attributes = (span as any).getAttributes()
    } else if ((span as any).attributes) {
      attributes = (span as any).attributes
    } else if ((span as any)._spanData?.attributes) {
      attributes = (span as any)._spanData.attributes
    } else {
      logger.warn('Failed to read span attributes; falling back to defaults', {
        availableKeys: Object.keys(span),
        spanType: span.constructor.name
      })
    }

    // Read the remaining span fields.
    if (spanWithInternals._events) {
      events = spanWithInternals._events
    }
    if (spanWithInternals.name) {
      spanName = spanWithInternals.name
    }
    if (spanWithInternals.status) {
      spanStatus = spanWithInternals.status
    }
    if (spanWithInternals.kind !== undefined) {
      spanKind = spanWithInternals.kind
    }
    if (spanWithInternals.startTime) {
      startTime = spanWithInternals.startTime
    }
    if (spanWithInternals.endTime) {
      endTime = spanWithInternals.endTime
    }
    if (spanWithInternals.ended !== undefined) {
      ended = spanWithInternals.ended
    }
    // OTel SDK v2 exposes the parent as `parentSpanContext`; v1's `parentSpanId` string was removed
    // (always undefined here). Reading only the old field left every AI SDK span with an empty parent,
    // so `ai.streamText` & co. rendered as trace roots instead of nesting under `ai.turn`.
    if (spanWithInternals.parentSpanContext?.spanId) {
      parentSpanId = spanWithInternals.parentSpanContext.spanId
    }
    // Fallback: read the parent info we injected from attributes.
    if (!parentSpanId && attributes['trace.parentSpanId']) {
      parentSpanId = attributes['trace.parentSpanId']
    }
    if (spanWithInternals.links) {
      links = spanWithInternals.links
    }

    // Extract AI SDK-specific data.
    const tokenUsage = this.extractTokenUsage(attributes)
    const { inputs, outputs } = this.extractInputsOutputs(attributes)
    const formattedSpanName = this.formatSpanName(spanName)
    const spanTag = this.extractSpanTag(spanName, attributes)
    const typeSpecificData = this.extractSpanTypeSpecificData(attributes)

    const operationId = attributes['ai.operationId']
    logger.debug('Converting AI SDK span to SpanEntity', {
      spanName: spanName,
      operationId,
      spanTag,
      hasTokenUsage: !!tokenUsage,
      hasInputs: !!inputs,
      hasOutputs: !!outputs,
      hasTypeSpecificData: Object.keys(typeSpecificData).length > 0,
      attributesCount: Object.keys(attributes).length,
      topicId,
      modelName,
      spanId: spanContext.spanId,
      traceId: spanContext.traceId
    })

    // Convert to SpanEntity format
    const spanEntity: SpanEntity = {
      id: spanContext.spanId,
      name: formattedSpanName,
      parentId: parentSpanId,
      traceId: spanContext.traceId,
      status: this.convertSpanStatus(spanStatus.code),
      kind: this.convertSpanKind(spanKind),
      attributes: {
        ...this.filterRelevantAttributes(attributes),
        ...typeSpecificData,
        inputs: inputs,
        outputs: outputs,
        tags: spanTag,
        modelName: modelName || this.extractModelFromAttributes(attributes) || ''
      },
      isEnd: ended,
      events: events,
      startTime: this.convertTimestamp(startTime),
      endTime: endTime ? this.convertTimestamp(endTime) : null,
      links: links,
      topicId: topicId,
      usage: tokenUsage,
      modelName: modelName || this.extractModelFromAttributes(attributes)
    }

    logger.debug('AI SDK span successfully converted to SpanEntity', {
      spanName: spanName,
      operationId,
      spanId: spanContext.spanId,
      traceId: spanContext.traceId,
      topicId,
      entityId: spanEntity.id,
      hasUsage: !!spanEntity.usage,
      status: spanEntity.status,
      tags: spanEntity.attributes?.tags
    })

    return spanEntity
  }

  /**
   * Extract token usage from AI SDK attributes. Reads AI SDK v6 keys
   * (`ai.usage.inputTokens`/`outputTokens`/`totalTokens`/`cachedInputTokens`/`reasoningTokens`), the
   * legacy `promptTokens`/`completionTokens` aliases, the `gen_ai.usage.*` semantic-convention
   * spelling, and the single-value `ai.usage.tokens` embeddings shape. See the inline notes below.
   */
  private static extractTokenUsage(attributes: Record<string, any>): TokenUsage | undefined {
    const read = (...keys: string[]): number | undefined => {
      for (const key of keys) {
        const value = attributes[key]
        if (value === undefined || value === null || value === '') continue
        const n = Number(value)
        if (!Number.isNaN(n)) return n
      }
      return undefined
    }

    // AI SDK v6 emits `ai.usage.inputTokens`/`outputTokens`; `promptTokens`/`completionTokens` are
    // legacy aliases and `gen_ai.usage.*` is the semantic-convention spelling. Reading only the legacy
    // names dropped the top-level `ai.streamText` totals. Embeddings emit a single `ai.usage.tokens`.
    const input = read('ai.usage.inputTokens', 'ai.usage.promptTokens', 'gen_ai.usage.input_tokens', 'ai.usage.tokens')
    const output = read('ai.usage.outputTokens', 'ai.usage.completionTokens', 'gen_ai.usage.output_tokens')
    const total = read('ai.usage.totalTokens')
    const cached = read('ai.usage.cachedInputTokens')
    const reasoning = read('ai.usage.reasoningTokens')

    if (
      input === undefined &&
      output === undefined &&
      total === undefined &&
      cached === undefined &&
      reasoning === undefined
    ) {
      // Spans without token usage (e.g. tool calls) are expected.
      return undefined
    }

    const promptTokens = input ?? 0
    const completionTokens = output ?? 0
    // Object keys stay snake_case: this is the TokenUsage contract in trace-core/types/config.ts.
    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      // Prefer the SDK's reported total (it accounts for reasoning/cached), else sum the two.
      total_tokens: total ?? promptTokens + completionTokens,
      // cached input tokens are a subset of input; reasoning tokens a subset of output.
      ...(cached !== undefined ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
      ...(reasoning !== undefined ? { completion_tokens_details: { reasoning_tokens: reasoning } } : {})
    }
  }

  /**
   * Extract inputs and outputs from AI SDK attributes.
   * Maps precisely by span type per the AI SDK documentation.
   */
  private static extractInputsOutputs(attributes: Record<string, any>): { inputs?: any; outputs?: any } {
    const operationId = attributes['ai.operationId']
    let inputs: any = undefined
    let outputs: any = undefined

    logger.debug('Extracting inputs/outputs by operation type', {
      operationId,
      availableKeys: Object.keys(attributes).filter(
        (key) => key.includes('prompt') || key.includes('response') || key.includes('toolCall')
      )
    })

    // Extract data by operation type per the AI SDK documentation.
    switch (operationId) {
      case 'ai.generateText':
      case 'ai.streamText':
        // Top-level LLM spans: ai.prompt holds the input.
        inputs = {
          prompt: this.parseAttributeValue(attributes['ai.prompt'])
        }
        outputs = this.extractLLMOutputs(attributes)
        break

      case 'ai.generateText.doGenerate':
      case 'ai.streamText.doStream':
        // Provider spans: ai.prompt.messages holds the detailed input.
        inputs = {
          messages: this.parseAttributeValue(attributes['ai.prompt.messages']),
          tools: this.parseAttributeValue(attributes['ai.prompt.tools']),
          toolChoice: this.parseAttributeValue(attributes['ai.prompt.toolChoice'])
        }
        outputs = this.extractProviderOutputs(attributes)
        break

      case 'ai.toolCall':
        // Tool call spans: tool arguments and result.
        inputs = {
          toolName: attributes['ai.toolCall.name'],
          toolId: attributes['ai.toolCall.id'],
          args: this.parseAttributeValue(attributes['ai.toolCall.args'])
        }
        outputs = {
          result: this.parseAttributeValue(attributes['ai.toolCall.result'])
        }
        break

      default:
        // Fall back to the generic logic.
        inputs = this.extractGenericInputs(attributes)
        outputs = this.extractGenericOutputs(attributes)
        break
    }

    logger.debug('Extracted inputs/outputs', {
      operationId,
      hasInputs: !!inputs,
      hasOutputs: !!outputs,
      inputKeys: inputs ? Object.keys(inputs) : [],
      outputKeys: outputs ? Object.keys(outputs) : []
    })

    return { inputs, outputs }
  }

  /**
   * Extract outputs for top-level LLM spans.
   */
  private static extractLLMOutputs(attributes: Record<string, any>): any {
    const outputs: any = {}

    if (attributes['ai.response.text']) {
      outputs.text = attributes['ai.response.text']
    }
    if (attributes['ai.response.toolCalls']) {
      outputs.toolCalls = this.parseAttributeValue(attributes['ai.response.toolCalls'])
    }
    if (attributes['ai.response.finishReason']) {
      outputs.finishReason = attributes['ai.response.finishReason']
    }
    if (attributes['ai.settings.maxOutputTokens']) {
      outputs.maxOutputTokens = attributes['ai.settings.maxOutputTokens']
    }

    return Object.keys(outputs).length > 0 ? outputs : undefined
  }

  /**
   * Extract outputs for provider spans.
   */
  private static extractProviderOutputs(attributes: Record<string, any>): any {
    const outputs: any = {}

    if (attributes['ai.response.text']) {
      outputs.text = attributes['ai.response.text']
    }
    if (attributes['ai.response.toolCalls']) {
      outputs.toolCalls = this.parseAttributeValue(attributes['ai.response.toolCalls'])
    }
    if (attributes['ai.response.finishReason']) {
      outputs.finishReason = attributes['ai.response.finishReason']
    }

    // Performance metrics specific to doStream.
    if (attributes['ai.response.msToFirstChunk']) {
      outputs.msToFirstChunk = attributes['ai.response.msToFirstChunk']
    }
    if (attributes['ai.response.msToFinish']) {
      outputs.msToFinish = attributes['ai.response.msToFinish']
    }
    if (attributes['ai.response.avgCompletionTokensPerSecond']) {
      outputs.avgCompletionTokensPerSecond = attributes['ai.response.avgCompletionTokensPerSecond']
    }

    return Object.keys(outputs).length > 0 ? outputs : undefined
  }

  /**
   * Generic input extraction (fallback logic).
   */
  private static extractGenericInputs(attributes: Record<string, any>): any {
    const inputKeys = ['ai.prompt', 'ai.prompt.messages', 'ai.request', 'inputs']

    for (const key of inputKeys) {
      if (attributes[key]) {
        return this.parseAttributeValue(attributes[key])
      }
    }
    return undefined
  }

  /**
   * Generic output extraction (fallback logic).
   */
  private static extractGenericOutputs(attributes: Record<string, any>): any {
    const outputKeys = ['ai.response.text', 'ai.response', 'ai.output', 'outputs']

    for (const key of outputKeys) {
      if (attributes[key]) {
        return this.parseAttributeValue(attributes[key])
      }
    }
    return undefined
  }

  /**
   * Parse an attribute value, handling stringified JSON.
   */
  private static parseAttributeValue(value: any): any {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch (e) {
        return value
      }
    }
    return value
  }

  /**
   * Format the span name, handling the AI SDK hierarchy.
   */
  private static formatSpanName(name: string): string {
    // AI SDK span names may be ai.generateText, ai.streamText.doStream, etc.
    // Keep the original name; formatting logic can be added here if needed.
    if (name.startsWith('ai.')) {
      return name
    }
    return name
  }

  /**
   * Extract a precise span tag from the AI SDK operationId.
   */
  private static extractSpanTag(name: string, attributes: Record<string, any>): string {
    const operationId = attributes['ai.operationId']

    logger.debug('Extracting span tag', {
      spanName: name,
      operationId,
      operationName: attributes['operation.name']
    })

    // Classify precisely by operationId per the AI SDK documentation.
    switch (operationId) {
      case 'ai.generateText':
        return 'LLM-GENERATE'
      case 'ai.streamText':
        return 'LLM-STREAM'
      case 'ai.generateText.doGenerate':
        return 'PROVIDER-GENERATE'
      case 'ai.streamText.doStream':
        return 'PROVIDER-STREAM'
      case 'ai.toolCall':
        return 'TOOL-CALL'
      case 'ai.generateImage':
        return 'IMAGE'
      case 'ai.embed':
        return 'EMBEDDING'
      default:
        // Fallback logic: based on the span name.
        if (name.includes('generateText') || name.includes('streamText')) {
          return 'LLM'
        }
        if (name.includes('generateImage')) {
          return 'IMAGE'
        }
        if (name.includes('embed')) {
          return 'EMBEDDING'
        }
        if (name.includes('toolCall')) {
          return 'TOOL'
        }

        // Final fallback.
        return attributes['ai.operationType'] || attributes['operation.type'] || 'AI_SDK'
    }
  }

  /**
   * Extract extra data specific to the span type.
   */
  private static extractSpanTypeSpecificData(attributes: Record<string, any>): Record<string, any> {
    const operationId = attributes['ai.operationId']
    const specificData: Record<string, any> = {}

    switch (operationId) {
      case 'ai.generateText':
      case 'ai.streamText':
        // Data specific to top-level LLM spans.
        if (attributes['ai.settings.maxOutputTokens']) {
          specificData.maxOutputTokens = attributes['ai.settings.maxOutputTokens']
        }
        if (attributes['resource.name']) {
          specificData.functionId = attributes['resource.name']
        }
        break

      case 'ai.generateText.doGenerate':
      case 'ai.streamText.doStream':
        // Data specific to provider spans.
        if (attributes['ai.model.id']) {
          specificData.providerId = attributes['ai.model.provider'] || 'unknown'
          specificData.modelId = attributes['ai.model.id']
        }

        // Performance data specific to doStream.
        if (operationId === 'ai.streamText.doStream') {
          if (attributes['ai.response.msToFirstChunk']) {
            specificData.msToFirstChunk = attributes['ai.response.msToFirstChunk']
          }
          if (attributes['ai.response.msToFinish']) {
            specificData.msToFinish = attributes['ai.response.msToFinish']
          }
          if (attributes['ai.response.avgCompletionTokensPerSecond']) {
            specificData.tokensPerSecond = attributes['ai.response.avgCompletionTokensPerSecond']
          }
        }
        break

      case 'ai.toolCall':
        // Data specific to tool call spans.
        specificData.toolName = attributes['ai.toolCall.name']
        specificData.toolId = attributes['ai.toolCall.id']

        // Per the documentation, a tool call may have different operation types.
        if (attributes['operation.name']) {
          specificData.operationName = attributes['operation.name']
        }
        break

      default:
        // Generic AI SDK attributes.
        if (attributes['ai.telemetry.functionId']) {
          specificData.telemetryFunctionId = attributes['ai.telemetry.functionId']
        }
        if (attributes['ai.telemetry.metadata']) {
          specificData.telemetryMetadata = this.parseAttributeValue(attributes['ai.telemetry.metadata'])
        }
        break
    }

    // Add the generic operation identifiers.
    if (operationId) {
      specificData.operationType = operationId
    }
    if (attributes['operation.name']) {
      specificData.operationName = attributes['operation.name']
    }

    return specificData
  }

  /**
   * Extract the model name from attributes.
   */
  private static extractModelFromAttributes(attributes: Record<string, any>): string | undefined {
    return (
      attributes['ai.model.id'] ||
      attributes['ai.model'] ||
      attributes['model.id'] ||
      attributes['model'] ||
      attributes['modelName']
    )
  }

  /**
   * Filter relevant attributes, removing unneeded system attributes.
   */
  private static filterRelevantAttributes(attributes: Record<string, any>): Record<string, any> {
    const filtered: Record<string, any> = {}

    // Keep useful attributes; drop those already handled separately.
    const excludeKeys = ['ai.usage', 'ai.prompt', 'ai.response', 'ai.input', 'ai.output', 'inputs', 'outputs']

    Object.entries(attributes).forEach(([key, value]) => {
      if (!excludeKeys.includes(key)) {
        filtered[key] = value
      }
    })

    return filtered
  }

  /**
   * Convert the span status.
   */
  private static convertSpanStatus(statusCode?: SpanStatusCode): string {
    switch (statusCode) {
      case SpanStatusCode.OK:
        return 'OK'
      case SpanStatusCode.ERROR:
        return 'ERROR'
      case SpanStatusCode.UNSET:
      default:
        return 'UNSET'
    }
  }

  /**
   * Convert the span kind.
   */
  private static convertSpanKind(kind?: SpanKind): string {
    switch (kind) {
      case SpanKind.INTERNAL:
        return 'INTERNAL'
      case SpanKind.CLIENT:
        return 'CLIENT'
      case SpanKind.SERVER:
        return 'SERVER'
      case SpanKind.PRODUCER:
        return 'PRODUCER'
      case SpanKind.CONSUMER:
        return 'CONSUMER'
      default:
        return 'INTERNAL'
    }
  }

  /**
   * Convert OpenTelemetry HrTime to integer milliseconds.
   * Matches trace-core's spanConvert (Math.floor on the nanosecond term) so AI SDK spans
   * use the same integer-millisecond representation as the rest of the pipeline.
   */
  private static convertTimestamp(timestamp: [number, number] | number): number {
    if (Array.isArray(timestamp)) {
      // OpenTelemetry high-resolution timestamp [seconds, nanoseconds]
      return timestamp[0] * 1e3 + Math.floor(timestamp[1] / 1e6)
    }
    return timestamp
  }
}
