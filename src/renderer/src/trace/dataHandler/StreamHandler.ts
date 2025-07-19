import { TokenUsage } from '@mcp-trace/trace-core'
import { Span } from '@opentelemetry/api'
import { endSpan } from '@renderer/services/SpanManagerService'
import { OpenAI } from 'openai'
import { Stream } from 'openai/streaming'

export class StreamHandler {
  private topicId: string
  private span: Span
  private modelName?: string
  private usage: TokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0
  }
  private stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk | OpenAI.Responses.ResponseStreamEvent>

  constructor(
    topicId: string,
    span: Span,
    stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk | OpenAI.Responses.ResponseStreamEvent>,
    modelName?: string
  ) {
    this.topicId = topicId
    this.span = span
    this.modelName = modelName
    this.stream = stream
  }

  async *createStreamAdapter(): AsyncIterable<
    OpenAI.Chat.Completions.ChatCompletionChunk | OpenAI.Responses.ResponseStreamEvent
  > {
    try {
      for await (const chunk of this.stream) {
        let context: string | undefined
        if ('object' in chunk && chunk.object === 'chat.completion.chunk') {
          const completionChunk = chunk as OpenAI.Chat.Completions.ChatCompletionChunk
          if (completionChunk.usage) {
            this.usage.completion_tokens += completionChunk.usage.completion_tokens || 0
            this.usage.prompt_tokens += completionChunk.usage.prompt_tokens || 0
            this.usage.total_tokens += completionChunk.usage.total_tokens || 0
          }
          context = chunk.choices
            .map((choice) => {
              if (!choice.delta) {
                return ''
              } else if ('reasoning_content' in choice.delta) {
                return choice.delta.reasoning_content
              } else if (choice.delta.content) {
                return choice.delta.content
              } else if (choice.delta.refusal) {
                return choice.delta.refusal
              } else if (choice.delta.tool_calls) {
                return choice.delta.tool_calls.map((toolCall) => {
                  return toolCall.function?.name || toolCall.function?.arguments
                })
              }
              return ''
            })
            .join()
        } else {
          const resp = chunk as OpenAI.Responses.ResponseStreamEvent
          if ('response' in resp && resp.response) {
            context = resp.response.output_text
            if (resp.response.usage) {
              this.usage.completion_tokens += resp.response.usage.output_tokens || 0
              this.usage.prompt_tokens += resp.response.usage.input_tokens || 0
              this.usage.total_tokens += (resp.response.usage.input_tokens || 0) + resp.response.usage.output_tokens
            }
          } else if ('delta' in resp && resp.delta) {
            context = typeof resp.delta === 'string' ? resp.delta : JSON.stringify(resp.delta)
          } else if ('text' in resp && resp.text) {
            context = resp.text
          } else if ('partial_image_b64' in resp && resp.partial_image_b64) {
            context = '<Image Data>'
          } else if ('part' in resp && resp.part) {
            context = 'refusal' in resp.part ? resp.part.refusal : resp.part.text
          } else {
            context = ''
          }
        }
        window.api.trace.addStreamMessage(this.span.spanContext().spanId, this.modelName || '', context, chunk)
        yield chunk
      }
      this.finish()
    } catch (err) {
      endSpan({ topicId: this.topicId, error: err as Error, span: this.span, modelName: this.modelName })
      throw err
    }
  }

  async finish() {
    window.api.trace.tokenUsage(this.span.spanContext().spanId, this.usage)
    endSpan({ topicId: this.topicId, span: this.span, modelName: this.modelName })
  }

  static handleStream(
    stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk | OpenAI.Responses.ResponseStreamEvent>,
    span?: Span,
    topicId?: string,
    modelName?: string
  ) {
    if (!span || !topicId) {
      return stream
    }
    return new StreamHandler(topicId, span, stream, modelName).createStreamAdapter()
  }
}

export const handleStream = StreamHandler.handleStream
