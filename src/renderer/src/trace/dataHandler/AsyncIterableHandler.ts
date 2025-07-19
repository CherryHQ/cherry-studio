import { TokenUsage } from '@mcp-trace/trace-core'
import { Span } from '@opentelemetry/api'
import { endSpan } from '@renderer/services/SpanManagerService'
import { SdkRawChunk } from '@renderer/types/sdk'

export class AsyncIterableHandler {
  private span: Span
  private stream: AsyncIterable<SdkRawChunk>
  private topicId: string
  private usageToken: TokenUsage
  private modelName?: string
  constructor(stream: AsyncIterable<SdkRawChunk>, span: Span, topicId: string, modelName?: string) {
    this.stream = this.transformStream(stream)
    this.span = span
    this.topicId = topicId
    this.modelName = modelName
    this.usageToken = {
      completion_tokens: 0,
      prompt_tokens: 0,
      total_tokens: 0
    }
  }

  async handleChunk(chunk: SdkRawChunk) {
    let context = 'choices' in chunk ? chunk.choices.map((ch) => ch.delta.context).join() : ''
    if (!context && 'candidates' in chunk && chunk.candidates) {
      context = chunk.candidates
        .map(
          (ch) =>
            ch.content?.parts
              ?.map((p) => {
                if (p.text) {
                  return p.text
                } else if (p.functionCall) {
                  return `${p.functionCall.name}(${JSON.stringify(p.functionCall.args || '')})`
                } else if (p.codeExecutionResult) {
                  return p.codeExecutionResult.output || String(p.codeExecutionResult.outcome || '')
                } else if (p.executableCode) {
                  return `'''${p.executableCode.language || ''}\n${p.executableCode.code}\n'''`
                } else if (p.fileData) {
                  return '<Blob Data>'
                } else if (p.functionResponse) {
                  return `${p.functionResponse.name}: ${JSON.stringify(p.functionResponse.response)}`
                } else if (p.inlineData) {
                  return '<File Data>'
                } else if (p.videoMetadata) {
                  return `fps: ${p.videoMetadata.fps}, start:${p.videoMetadata.startOffset}, end:${p.videoMetadata.endOffset}`
                } else {
                  return ''
                }
              })
              .join() || ''
        )
        .join()
    }
    if (context) {
      window.api.trace.addStreamMessage(this.span.spanContext().spanId, this.modelName || '', context, chunk)
    }
    if ('usageMetadata' in chunk && chunk.usageMetadata) {
      this.usageToken.prompt_tokens = chunk.usageMetadata.promptTokenCount || 0
      this.usageToken.total_tokens = chunk.usageMetadata.totalTokenCount || 0
      this.usageToken.completion_tokens =
        (chunk.usageMetadata.totalTokenCount || 0) - (chunk.usageMetadata.promptTokenCount || 0)
    }
  }

  async finish() {
    window.api.trace.tokenUsage(this.span.spanContext().spanId, this.usageToken)
    endSpan({ topicId: this.topicId, span: this.span, modelName: this.modelName })
  }

  async handleError(err) {
    endSpan({ topicId: this.topicId, error: err, span: this.span, modelName: this.modelName })
  }

  async *transformStream(stream: AsyncIterable<SdkRawChunk>) {
    try {
      for await (const chunk of stream) {
        this.handleChunk(chunk)
        yield chunk
      }
    } catch (err) {
      this.handleError(err)
      throw err
    }
    this.finish()
  }

  static handleStream(stream: AsyncIterable<SdkRawChunk>, span?: Span, topicId?: string, modelName?: string) {
    if (!span || !topicId) {
      return stream
    }
    const handler = new AsyncIterableHandler(stream, span!, topicId, modelName)
    return handler.stream
  }
}

export const handleAsyncIterable = AsyncIterableHandler.handleStream
