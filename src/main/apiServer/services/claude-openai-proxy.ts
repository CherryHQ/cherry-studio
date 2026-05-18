import OpenAI from '@cherrystudio/openai'
import type { ChatCompletionCreateParams, ChatCompletionCreateParamsStreaming } from '@cherrystudio/openai/resources'
import { loggerService } from '@logger'
import type { Provider } from '@types'
import type { Response } from 'express'

import { getProviderById } from '../utils'

const logger = loggerService.withContext('ClaudeOpenAIProxyService')

type AnthropicContentBlock =
  | { type: 'text'; text?: string }
  | { type: 'tool_use'; id?: string; name?: string; input?: unknown }
  | { type: 'tool_result'; tool_use_id?: string; content?: unknown }
  | { type: string; [key: string]: unknown }

type AnthropicTextBlock = Extract<AnthropicContentBlock, { type: 'text' }>
type AnthropicToolUseBlock = Extract<AnthropicContentBlock, { type: 'tool_use' }>
type AnthropicToolResultBlock = Extract<AnthropicContentBlock, { type: 'tool_result' }>

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

type AnthropicTool = {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

export type AnthropicMessagesRequest = {
  model: string
  max_tokens?: number
  messages: AnthropicMessage[]
  system?: string | AnthropicContentBlock[]
  stream?: boolean
  temperature?: number
  top_p?: number
  stop_sequences?: string[]
  tools?: AnthropicTool[]
  tool_choice?: { type: string; name?: string }
}

type OpenAIMessage = NonNullable<ChatCompletionCreateParams['messages']>[number]
type OpenAITool = NonNullable<ChatCompletionCreateParams['tools']>[number]
type OpenAIChunk = OpenAI.Chat.Completions.ChatCompletionChunk
type OpenAICompletion = OpenAI.Chat.Completions.ChatCompletion

const OPENAI_COMPATIBLE_PROVIDER_TYPES = new Set(['openai', 'openai-response', 'new-api'])

const isTextBlock = (block: AnthropicContentBlock): block is AnthropicTextBlock => block.type === 'text'

const isToolUseBlock = (block: AnthropicContentBlock): block is AnthropicToolUseBlock => block.type === 'tool_use'

const isToolResultBlock = (block: AnthropicContentBlock): block is AnthropicToolResultBlock =>
  block.type === 'tool_result'

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) return String((item as { text?: unknown }).text ?? '')
        return JSON.stringify(item)
      })
      .filter(Boolean)
      .join('\n')
  }
  if (value === undefined || value === null) return ''
  return JSON.stringify(value)
}

const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

const mapStopReason = (finishReason: string | null | undefined): string => {
  switch (finishReason) {
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'stop':
    default:
      return 'end_turn'
  }
}

export class ClaudeOpenAIProxyValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('; '))
    this.name = 'ClaudeOpenAIProxyValidationError'
  }
}

export class ClaudeOpenAIProxyProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeOpenAIProxyProviderError'
  }
}

export class ClaudeOpenAIProxyService {
  validateRequest(request: AnthropicMessagesRequest, options: { requireMaxTokens?: boolean } = {}): void {
    const requireMaxTokens = options.requireMaxTokens ?? true
    const errors: string[] = []

    if (!request || typeof request !== 'object') errors.push('Request body is required')
    if (!request.model || typeof request.model !== 'string') errors.push('model is required')
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      errors.push('messages is required and must be a non-empty array')
    }
    if (
      requireMaxTokens &&
      (typeof request.max_tokens !== 'number' || !Number.isFinite(request.max_tokens) || request.max_tokens < 1)
    ) {
      errors.push('max_tokens is required and must be a positive number')
    }

    if (errors.length > 0) throw new ClaudeOpenAIProxyValidationError(errors)
  }

  async resolveProvider(providerId: string): Promise<Provider> {
    const provider = await getProviderById(providerId)
    if (!provider) {
      throw new ClaudeOpenAIProxyProviderError(`Provider '${providerId}' not found or not enabled`)
    }
    if (!OPENAI_COMPATIBLE_PROVIDER_TYPES.has(provider.type)) {
      throw new ClaudeOpenAIProxyProviderError(
        `Provider '${provider.id}' of type '${provider.type}' is not OpenAI-compatible for Claude proxy requests`
      )
    }
    if (!provider.apiHost) {
      throw new ClaudeOpenAIProxyProviderError(`Provider '${provider.id}' is missing apiHost`)
    }
    return provider
  }

  createClient(provider: Provider): OpenAI {
    const apiKey = provider.apiKey ? provider.apiKey.split(',')[0].trim() : provider.id
    return new OpenAI({ baseURL: provider.apiHost, apiKey })
  }

  toOpenAIRequest(request: AnthropicMessagesRequest, stream: boolean): ChatCompletionCreateParams {
    const messages: OpenAIMessage[] = []

    const system = this.systemToText(request.system)
    if (system) {
      messages.push({ role: 'system', content: system } as OpenAIMessage)
    }

    for (const message of request.messages) {
      messages.push(...this.toOpenAIMessages(message))
    }

    const openAIRequest: ChatCompletionCreateParams = {
      model: request.model,
      messages,
      stream,
      temperature: request.temperature,
      top_p: request.top_p,
      max_tokens: request.max_tokens,
      stop: request.stop_sequences,
      tools: request.tools?.map(this.toOpenAITool),
      tool_choice: this.toOpenAIToolChoice(request.tool_choice)
    }

    return Object.fromEntries(
      Object.entries(openAIRequest).filter(([, value]) => value !== undefined)
    ) as ChatCompletionCreateParams
  }

  async createMessage(providerId: string, request: AnthropicMessagesRequest): Promise<unknown> {
    this.validateRequest(request)
    const provider = await this.resolveProvider(providerId)
    const client = this.createClient(provider)
    const openAIRequest = this.toOpenAIRequest(request, false)
    const response = (await client.chat.completions.create(openAIRequest)) as OpenAICompletion
    return this.toAnthropicMessage(response, request.model)
  }

  async streamMessage(providerId: string, request: AnthropicMessagesRequest, response: Response): Promise<void> {
    this.validateRequest(request)
    const provider = await this.resolveProvider(providerId)
    const client = this.createClient(provider)
    const openAIRequest = this.toOpenAIRequest(request, true) as ChatCompletionCreateParamsStreaming

    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('X-Accel-Buffering', 'no')
    response.flushHeaders()

    const stream = (await client.chat.completions.create(openAIRequest)) as AsyncIterable<OpenAIChunk>
    const messageId = createId('msg_proxy')
    const state = new AnthropicStreamState(response, messageId, request.model)

    try {
      state.writeMessageStart()

      for await (const chunk of stream) {
        state.consume(chunk)
      }

      state.finish()
    } catch (error) {
      logger.error('Claude OpenAI proxy stream failed', { error, providerId, model: request.model })
      state.writeError(error)
    } finally {
      if (!response.writableEnded) response.end()
    }
  }

  async countTokens(providerId: string, request: AnthropicMessagesRequest): Promise<{ input_tokens: number }> {
    this.validateRequest(request, { requireMaxTokens: false })
    await this.resolveProvider(providerId)
    const text = [this.systemToText(request.system), ...request.messages.map((message) => toText(message.content))]
      .filter(Boolean)
      .join('\n')
    return { input_tokens: Math.max(1, Math.ceil(text.length / 4)) }
  }

  private systemToText(system: AnthropicMessagesRequest['system']): string {
    if (!system) return ''
    if (typeof system === 'string') return system
    return system
      .filter(isTextBlock)
      .map((block) => toText(block.text))
      .filter(Boolean)
      .join('\n')
  }

  private toOpenAIMessages(message: AnthropicMessage): OpenAIMessage[] {
    if (typeof message.content === 'string') {
      return [{ role: message.role, content: message.content } as OpenAIMessage]
    }

    const result: OpenAIMessage[] = []
    const textParts: string[] = []
    const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = []

    for (const block of message.content) {
      if (isTextBlock(block)) {
        const text = toText(block.text)
        if (text) textParts.push(text)
      } else if (isToolUseBlock(block)) {
        toolCalls.push({
          id: block.id || createId('call_proxy'),
          type: 'function',
          function: {
            name: block.name || 'unknown_tool',
            arguments: JSON.stringify(block.input ?? {})
          }
        })
      } else if (isToolResultBlock(block)) {
        result.push({
          role: 'tool',
          tool_call_id: block.tool_use_id || createId('call_proxy'),
          content: toText(block.content)
        } as OpenAIMessage)
      }
    }

    if (message.role === 'assistant' && toolCalls.length > 0) {
      result.unshift({
        role: 'assistant',
        content: textParts.join('\n') || null,
        tool_calls: toolCalls
      } as OpenAIMessage)
    } else if (textParts.length > 0) {
      result.unshift({ role: message.role, content: textParts.join('\n') } as OpenAIMessage)
    }

    return result
  }

  private toOpenAITool(tool: AnthropicTool): OpenAITool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema || { type: 'object', properties: {} }
      }
    } as OpenAITool
  }

  private toOpenAIToolChoice(
    toolChoice: AnthropicMessagesRequest['tool_choice']
  ): ChatCompletionCreateParams['tool_choice'] {
    if (!toolChoice) return undefined
    if (toolChoice.type === 'auto') return 'auto'
    if (toolChoice.type === 'any') return 'required'
    if (toolChoice.type === 'tool' && toolChoice.name) {
      return { type: 'function', function: { name: toolChoice.name } }
    }
    return undefined
  }

  private toAnthropicMessage(response: OpenAICompletion, fallbackModel: string): unknown {
    const choice = response.choices?.[0]
    const message = choice?.message
    const content: unknown[] = []
    const text = typeof message?.content === 'string' ? message.content : ''

    if (text) content.push({ type: 'text', text })
    for (const toolCall of message?.tool_calls ?? []) {
      if (!('function' in toolCall)) continue
      content.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function.name,
        input: this.safeJsonParse(toolCall.function.arguments)
      })
    }

    return {
      id: createId('msg_proxy'),
      type: 'message',
      role: 'assistant',
      model: response.model || fallbackModel,
      content,
      stop_reason: mapStopReason(choice?.finish_reason),
      stop_sequence: null,
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0
      }
    }
  }

  private safeJsonParse(value: string): unknown {
    try {
      return value ? JSON.parse(value) : {}
    } catch {
      return {}
    }
  }
}

class AnthropicStreamState {
  private textBlockStarted = false
  private textBlockStopped = false
  private textBlockIndex: number | undefined
  private nextBlockIndex = 0
  private stopReason = 'end_turn'
  private usage = { input_tokens: 0, output_tokens: 0 }
  private readonly toolBlocks = new Map<number, { blockIndex: number; id: string; name: string; stopped: boolean }>()

  constructor(
    private readonly response: Response,
    private readonly messageId: string,
    private readonly model: string
  ) {}

  writeMessageStart(): void {
    this.write('message_start', {
      type: 'message_start',
      message: {
        id: this.messageId,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: this.usage
      }
    })
  }

  consume(chunk: OpenAIChunk): void {
    const usage = chunk.usage
    if (usage) {
      this.usage = {
        input_tokens: usage.prompt_tokens ?? this.usage.input_tokens,
        output_tokens: usage.completion_tokens ?? this.usage.output_tokens
      }
    }

    const choice = chunk.choices?.[0]
    if (!choice) return

    const delta = choice.delta
    if (delta?.content) this.writeTextDelta(delta.content)

    for (const toolCall of delta?.tool_calls ?? []) {
      this.writeToolDelta(toolCall)
    }

    if (choice.finish_reason) {
      this.stopReason = mapStopReason(choice.finish_reason)
    }
  }

  finish(): void {
    this.stopOpenBlocks()
    this.write('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: this.stopReason, stop_sequence: null },
      usage: { output_tokens: this.usage.output_tokens }
    })
    this.write('message_stop', { type: 'message_stop' })
    this.write(undefined, '[DONE]')
  }

  writeError(error: unknown): void {
    this.write('error', {
      type: 'error',
      error: {
        type: 'api_error',
        message: error instanceof Error ? error.message : 'Claude OpenAI proxy stream failed'
      }
    })
  }

  private writeTextDelta(text: string): void {
    if (!this.textBlockStarted) {
      this.textBlockStarted = true
      const index = this.nextBlockIndex++
      this.textBlockIndex = index
      this.write('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' }
      })
    }

    this.write('content_block_delta', {
      type: 'content_block_delta',
      index: this.textBlockIndex ?? 0,
      delta: { type: 'text_delta', text }
    })
  }

  private writeToolDelta(
    toolCall: NonNullable<NonNullable<OpenAIChunk['choices'][number]['delta']['tool_calls']>[number]>
  ): void {
    const openAIIndex = toolCall.index ?? 0
    let block = this.toolBlocks.get(openAIIndex)

    if (!block) {
      block = {
        blockIndex: this.nextBlockIndex++,
        id: toolCall.id || createId('call_proxy'),
        name: toolCall.function?.name || 'unknown_tool',
        stopped: false
      }
      this.toolBlocks.set(openAIIndex, block)
      this.write('content_block_start', {
        type: 'content_block_start',
        index: block.blockIndex,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} }
      })
    }

    const partialJson = toolCall.function?.arguments
    if (partialJson) {
      this.write('content_block_delta', {
        type: 'content_block_delta',
        index: block.blockIndex,
        delta: { type: 'input_json_delta', partial_json: partialJson }
      })
    }
  }

  private stopOpenBlocks(): void {
    if (this.textBlockStarted && !this.textBlockStopped) {
      this.write('content_block_stop', { type: 'content_block_stop', index: this.textBlockIndex ?? 0 })
      this.textBlockStopped = true
    }

    for (const block of this.toolBlocks.values()) {
      if (!block.stopped) {
        this.write('content_block_stop', { type: 'content_block_stop', index: block.blockIndex })
        block.stopped = true
      }
    }
  }

  private write(eventType: string | undefined, payload: unknown): void {
    if (this.response.writableEnded || this.response.destroyed) return
    if (eventType) this.response.write(`event: ${eventType}\n`)
    this.response.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)
    const flushable = this.response as Response & { flush?: () => void }
    flushable.flush?.()
  }
}

export const claudeOpenAIProxyService = new ClaudeOpenAIProxyService()
