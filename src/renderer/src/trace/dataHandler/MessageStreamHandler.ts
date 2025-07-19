import { Message, MessageStream } from '@anthropic-ai/sdk/resources/messages/messages'
import { TokenUsage } from '@mcp-trace/trace-core'
import { Span } from '@opentelemetry/api'
import { endSpan } from '@renderer/services/SpanManagerService'

export class MessageStreamHandler {
  private span: Span
  private stream: MessageStream
  private topicId: string
  private tokenUsage: TokenUsage
  private modelName?: string

  constructor(stream: MessageStream, span: Span, topicId: string, modelName?: string) {
    this.stream = stream
    this.span = span
    this.topicId = topicId
    this.tokenUsage = {
      completion_tokens: 0,
      prompt_tokens: 0,
      total_tokens: 0
    }
    stream.on('error', (err) => {
      endSpan({ topicId, error: err, span, modelName: this.modelName })
    })
    stream.on('message', (message) => this.write(message))
    stream.on('end', () => this.finish())
    this.modelName = modelName
  }

  async finish() {
    window.api.trace.tokenUsage(this.span.spanContext().spanId, this.tokenUsage)
    endSpan({ topicId: this.topicId, span: this.span, modelName: this.modelName })
  }

  async write(message: Message) {
    if (message.usage) {
      this.tokenUsage.completion_tokens += message.usage.output_tokens
      this.tokenUsage.prompt_tokens += message.usage.input_tokens
      this.tokenUsage.total_tokens += message.usage.output_tokens + message.usage.input_tokens
    }
    const context = message.content
      .map((c) => {
        if (c.type === 'text') {
          return c.text
        } else if (c.type === 'redacted_thinking') {
          return c.data
        } else if (c.type === 'server_tool_use' || c.type === 'tool_use') {
          return `${c.name}: ${c.input}`
        } else if (c.type === 'thinking') {
          return c.thinking
        } else if (c.type === 'web_search_tool_result') {
          return c.content
        } else {
          return JSON.stringify(c)
        }
      })
      .join()
    window.api.trace.addStreamMessage(this.span.spanContext().spanId, this.modelName || '', context, message)
  }

  static handleStream(stream: MessageStream, span?: Span, topicId?: string, modelName?: string) {
    if (!span || !topicId) {
      return stream
    }
    const handler = new MessageStreamHandler(stream, span!, topicId, modelName)
    return handler.stream
  }
}

export const handleMessageStream = MessageStreamHandler.handleStream
