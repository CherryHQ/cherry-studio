/**
 * AI SDK Span Adapter
 *
 * 将 AI SDK 的 telemetry 数据转换为现有的 SpanEntity 格式
 * 注意 AI SDK 的层级结构：ai.xxx 是一个层级，ai.xxx.xxx 是对应层级下的子集
 */

import { loggerService } from '@logger'
import { SpanEntity, TokenUsage } from '@mcp-trace/trace-core'
import { Span, SpanKind, SpanStatusCode } from '@opentelemetry/api'

const logger = loggerService.withContext('AiSdkSpanAdapter')

export interface AiSdkSpanData {
  span: Span
  topicId?: string
  modelName?: string
}

// 扩展接口用于访问span的内部数据
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
  parentSpanId?: string
  links?: any[]
}

export class AiSdkSpanAdapter {
  /**
   * 将 AI SDK span 转换为 SpanEntity 格式
   */
  static convertToSpanEntity(spanData: AiSdkSpanData): SpanEntity {
    const { span, topicId, modelName } = spanData
    const spanContext = span.spanContext()

    // 尝试从不同方式获取span数据
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

    // 详细记录span的结构信息用于调试
    logger.debug('Debugging span structure', {
      hasInternalAttributes: !!spanWithInternals._attributes,
      hasGetAttributes: typeof (span as any).getAttributes === 'function',
      spanKeys: Object.keys(span),
      spanInternalKeys: Object.keys(spanWithInternals),
      spanContext: span.spanContext(),
      // 尝试获取所有可能的属性路径
      attributesPath1: spanWithInternals._attributes,
      attributesPath2: (span as any).attributes,
      attributesPath3: (span as any)._spanData?.attributes,
      attributesPath4: (span as any).resource?.attributes
    })

    // 尝试多种方式获取attributes
    if (spanWithInternals._attributes) {
      attributes = spanWithInternals._attributes
      logger.debug('Found attributes via _attributes', { attributeCount: Object.keys(attributes).length })
    } else if (typeof (span as any).getAttributes === 'function') {
      attributes = (span as any).getAttributes()
      logger.debug('Found attributes via getAttributes()', { attributeCount: Object.keys(attributes).length })
    } else if ((span as any).attributes) {
      attributes = (span as any).attributes
      logger.debug('Found attributes via direct attributes property', {
        attributeCount: Object.keys(attributes).length
      })
    } else if ((span as any)._spanData?.attributes) {
      attributes = (span as any)._spanData.attributes
      logger.debug('Found attributes via _spanData.attributes', { attributeCount: Object.keys(attributes).length })
    } else {
      // 尝试从span的其他属性获取
      logger.warn('无法获取span attributes，尝试备用方法', {
        availableKeys: Object.keys(span),
        spanType: span.constructor.name
      })
    }

    // 获取其他属性
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
    if (spanWithInternals.parentSpanId) {
      parentSpanId = spanWithInternals.parentSpanId
    }
    // 兜底：尝试从 attributes 中读取我们注入的父信息
    if (!parentSpanId && attributes['trace.parentSpanId']) {
      parentSpanId = attributes['trace.parentSpanId']
    }
    if (spanWithInternals.links) {
      links = spanWithInternals.links
    }

    // 提取 AI SDK 特有的数据
    const tokenUsage = this.extractTokenUsage(attributes)
    const { inputs, outputs } = this.extractInputsOutputs(attributes)
    const formattedSpanName = this.formatSpanName(spanName)
    const spanTag = this.extractSpanTag(spanName, attributes)
    const typeSpecificData = this.extractSpanTypeSpecificData(attributes)

    // 详细记录转换过程
    const operationId = attributes['ai.operationId']
    logger.info('Converting AI SDK span to SpanEntity', {
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

    if (tokenUsage) {
      logger.info('Token usage data found', {
        spanName: spanName,
        operationId,
        usage: tokenUsage,
        spanId: spanContext.spanId
      })
    }

    if (inputs || outputs) {
      logger.info('Input/Output data extracted', {
        spanName: spanName,
        operationId,
        hasInputs: !!inputs,
        hasOutputs: !!outputs,
        inputKeys: inputs ? Object.keys(inputs) : [],
        outputKeys: outputs ? Object.keys(outputs) : [],
        spanId: spanContext.spanId
      })
    }

    if (Object.keys(typeSpecificData).length > 0) {
      logger.info('Type-specific data extracted', {
        spanName: spanName,
        operationId,
        typeSpecificKeys: Object.keys(typeSpecificData),
        spanId: spanContext.spanId
      })
    }

    // 转换为 SpanEntity 格式
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

    logger.info('AI SDK span successfully converted to SpanEntity', {
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
   * 从 AI SDK attributes 中提取 token usage
   * 支持多种格式：
   * - AI SDK 标准格式: ai.usage.completionTokens, ai.usage.promptTokens
   * - 完整usage对象格式: ai.usage (JSON字符串或对象)
   */
  private static extractTokenUsage(attributes: Record<string, any>): TokenUsage | undefined {
    logger.debug('Extracting token usage from attributes', {
      attributeKeys: Object.keys(attributes),
      usageRelatedKeys: Object.keys(attributes).filter((key) => key.includes('usage') || key.includes('token')),
      fullAttributes: attributes
    })

    const inputsTokenKeys = [
      // base span
      'ai.usage.promptTokens',
      // LLM span
      'gen_ai.usage.input_tokens'
    ]
    const outputTokenKeys = [
      // base span
      'ai.usage.completionTokens',
      // LLM span
      'gen_ai.usage.output_tokens'
    ]

    const completionTokens = attributes[inputsTokenKeys.find((key) => attributes[key]) || '']
    const promptTokens = attributes[outputTokenKeys.find((key) => attributes[key]) || '']

    if (completionTokens !== undefined || promptTokens !== undefined) {
      const usage: TokenUsage = {
        prompt_tokens: Number(promptTokens) || 0,
        completion_tokens: Number(completionTokens) || 0,
        total_tokens: (Number(promptTokens) || 0) + (Number(completionTokens) || 0)
      }

      logger.debug('Extracted token usage from AI SDK standard attributes', {
        usage,
        foundStandardAttributes: {
          'ai.usage.completionTokens': completionTokens,
          'ai.usage.promptTokens': promptTokens
        }
      })

      return usage
    }

    // 对于不包含token usage的spans（如tool calls），这是正常的
    logger.debug('No token usage found in span attributes (normal for tool calls)', {
      availableKeys: Object.keys(attributes),
      usageKeys: Object.keys(attributes).filter((key) => key.includes('usage') || key.includes('token'))
    })

    return undefined
  }

  /**
   * 从 AI SDK attributes 中提取 inputs 和 outputs
   * 根据AI SDK文档按不同span类型精确映射
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

    // 根据AI SDK文档按操作类型提取数据
    switch (operationId) {
      case 'ai.generateText':
      case 'ai.streamText':
        // 顶层LLM spans: ai.prompt 包含输入
        inputs = {
          prompt: this.parseAttributeValue(attributes['ai.prompt'])
        }
        outputs = this.extractLLMOutputs(attributes)
        break

      case 'ai.generateText.doGenerate':
      case 'ai.streamText.doStream':
        // Provider spans: ai.prompt.messages 包含详细输入
        inputs = {
          messages: this.parseAttributeValue(attributes['ai.prompt.messages']),
          tools: this.parseAttributeValue(attributes['ai.prompt.tools']),
          toolChoice: this.parseAttributeValue(attributes['ai.prompt.toolChoice'])
        }
        outputs = this.extractProviderOutputs(attributes)
        break

      case 'ai.toolCall':
        // Tool call spans: 工具参数和结果
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
        // 回退到通用逻辑
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
   * 提取LLM顶层spans的输出
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
   * 提取Provider spans的输出
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

    // doStream特有的性能指标
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
   * 通用输入提取（回退逻辑）
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
   * 通用输出提取（回退逻辑）
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
   * 解析属性值，处理字符串化的 JSON
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
   * 格式化 span 名称，处理 AI SDK 的层级结构
   */
  private static formatSpanName(name: string): string {
    // AI SDK 的 span 名称可能是 ai.generateText, ai.streamText.doStream 等
    // 保持原始名称，但可以添加一些格式化逻辑
    if (name.startsWith('ai.')) {
      return name
    }
    return name
  }

  /**
   * 从AI SDK operationId中提取精确的span标签
   */
  private static extractSpanTag(name: string, attributes: Record<string, any>): string {
    const operationId = attributes['ai.operationId']

    logger.debug('Extracting span tag', {
      spanName: name,
      operationId,
      operationName: attributes['operation.name']
    })

    // 根据AI SDK文档的operationId精确分类
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
        // 回退逻辑：基于span名称
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

        // 最终回退
        return attributes['ai.operationType'] || attributes['operation.type'] || 'AI_SDK'
    }
  }

  /**
   * 根据span类型提取特定的额外数据
   */
  private static extractSpanTypeSpecificData(attributes: Record<string, any>): Record<string, any> {
    const operationId = attributes['ai.operationId']
    const specificData: Record<string, any> = {}

    switch (operationId) {
      case 'ai.generateText':
      case 'ai.streamText':
        // LLM顶层spans的特定数据
        if (attributes['ai.settings.maxOutputTokens']) {
          specificData.maxOutputTokens = attributes['ai.settings.maxOutputTokens']
        }
        if (attributes['resource.name']) {
          specificData.functionId = attributes['resource.name']
        }
        break

      case 'ai.generateText.doGenerate':
      case 'ai.streamText.doStream':
        // Provider spans的特定数据
        if (attributes['ai.model.id']) {
          specificData.providerId = attributes['ai.model.provider'] || 'unknown'
          specificData.modelId = attributes['ai.model.id']
        }

        // doStream特有的性能数据
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
        // Tool call spans的特定数据
        specificData.toolName = attributes['ai.toolCall.name']
        specificData.toolId = attributes['ai.toolCall.id']

        // 根据文档，tool call可能有不同的操作类型
        if (attributes['operation.name']) {
          specificData.operationName = attributes['operation.name']
        }
        break

      default:
        // 通用的AI SDK属性
        if (attributes['ai.telemetry.functionId']) {
          specificData.telemetryFunctionId = attributes['ai.telemetry.functionId']
        }
        if (attributes['ai.telemetry.metadata']) {
          specificData.telemetryMetadata = this.parseAttributeValue(attributes['ai.telemetry.metadata'])
        }
        break
    }

    // 添加通用的操作标识
    if (operationId) {
      specificData.operationType = operationId
    }
    if (attributes['operation.name']) {
      specificData.operationName = attributes['operation.name']
    }

    logger.debug('Extracted type-specific data', {
      operationId,
      specificDataKeys: Object.keys(specificData),
      specificData
    })

    return specificData
  }

  /**
   * 从属性中提取模型名称
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
   * 过滤相关的属性，移除不需要的系统属性
   */
  private static filterRelevantAttributes(attributes: Record<string, any>): Record<string, any> {
    const filtered: Record<string, any> = {}

    // 保留有用的属性，过滤掉已经单独处理的属性
    const excludeKeys = ['ai.usage', 'ai.prompt', 'ai.response', 'ai.input', 'ai.output', 'inputs', 'outputs']

    Object.entries(attributes).forEach(([key, value]) => {
      if (!excludeKeys.includes(key)) {
        filtered[key] = value
      }
    })

    return filtered
  }

  /**
   * 转换 span 状态
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
   * 转换 span 类型
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
   * 转换时间戳格式
   */
  private static convertTimestamp(timestamp: [number, number] | number): number {
    if (Array.isArray(timestamp)) {
      // OpenTelemetry 高精度时间戳 [seconds, nanoseconds]
      return timestamp[0] * 1000 + timestamp[1] / 1000000
    }
    return timestamp
  }
}
