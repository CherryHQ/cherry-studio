import { TokenUsage } from '@mcp-trace/trace-core'
import { Span } from '@opentelemetry/api'
import { CompletionsResult } from '@renderer/aiCore/middleware/schemas'
import { endSpan } from '@renderer/services/SpanManagerService'

export class CompletionsResultHandler {
  private data: any
  private tokenUsage?: TokenUsage
  private span: Span
  private topicId: string
  private modelName?: string

  constructor(data: any, span: Span, topicId: string, modelName?: string) {
    this.data = data && this.isCompletionsResult(data) ? { ...data, finishText: data.getText() } : data
    this.span = span
    this.topicId = topicId
    this.tokenUsage = this.getUsage(data)
    this.modelName = modelName
  }

  isCompletionsResult(data: any): data is CompletionsResult {
    return (
      data !== null &&
      typeof data === 'object' &&
      typeof data.getText === 'function' &&
      (data.rawOutput === undefined || typeof data.rawOutput === 'object') &&
      (data.stream === undefined || typeof data.stream === 'object') &&
      (data.controller === undefined || data.controller instanceof AbortController)
    )
  }

  getUsage(data?: any): TokenUsage | undefined {
    // Replace this with an appropriate property check for CompletionsResult
    if (!data || typeof data !== 'object' || !('usage' in data || 'usageMetadata' in data)) {
      return undefined
    }
    const tokens: TokenUsage = {
      completion_tokens: 0,
      prompt_tokens: 0,
      total_tokens: 0
    }
    if ('usage' in data) {
      const usage = data.usage
      tokens.completion_tokens = usage['completion_tokens'] || 0
      tokens.prompt_tokens = usage['prompt_tokens'] || 0
      tokens.total_tokens = usage['total_tokens'] || 0
      // Do something with usage
    } else {
      const usage = data.usageMetadata
      tokens.completion_tokens = usage['thoughtsTokenCount'] || 0
      tokens.prompt_tokens = usage['promptTokenCount'] || 0
      tokens.total_tokens = usage['totalTokenCount'] || 0
    }
    return tokens
  }

  finish() {
    if (this.tokenUsage) {
      window.api.trace.tokenUsage(this.span.spanContext().spanId, this.tokenUsage)
    }
    if (this.data) {
      endSpan({ topicId: this.topicId, outputs: this.data, span: this.span, modelName: this.modelName })
    } else {
      endSpan({ topicId: this.topicId, span: this.span, modelName: this.modelName })
    }
  }

  static handleResult(data?: any, span?: Span, topicId?: string, modelName?: string) {
    if (span && topicId) {
      const handler = new CompletionsResultHandler(data, span!, topicId, modelName)
      handler.finish()
    }
    return data
  }
}

export const handleResult = CompletionsResultHandler.handleResult
