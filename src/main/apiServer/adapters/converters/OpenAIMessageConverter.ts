/**
 * OpenAI Message Converter
 *
 * Converts OpenAI Chat Completions API format to AI SDK format.
 * Handles messages, tools, and extended features like reasoning_content.
 */

import type { ProviderOptions, ReasoningPart, ToolCallPart, ToolResultPart } from '@ai-sdk/provider-utils'
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam
} from '@cherrystudio/openai/resources'
import type { ChatCompletionCreateParamsBase } from '@cherrystudio/openai/resources/chat/completions'
import type { Provider } from '@types'
import type { ImagePart, ModelMessage, TextPart, Tool as AiSdkTool } from 'ai'
import { tool, zodSchema } from 'ai'

import type { IMessageConverter, StreamTextOptions } from '../interfaces'
import { type JsonSchemaLike, jsonSchemaToZod } from './json-schema-to-zod'
import { mapReasoningEffortToProviderOptions } from './provider-options-mapper'

/**
 * Extended ChatCompletionCreateParams with reasoning_effort support
 * Extends the base OpenAI params to inherit all standard parameters
 */
export interface ExtendedChatCompletionCreateParams extends ChatCompletionCreateParamsBase {
  /**
   * Allow additional provider-specific parameters
   */
  [key: string]: unknown
}

/**
 * Extended assistant message with reasoning_content support (DeepSeek-style)
 */
interface ExtendedAssistantMessage extends ChatCompletionAssistantMessageParam {
  reasoning_content?: string | null
}

/**
 * OpenAI Message Converter
 *
 * Converts OpenAI Chat Completions API format to AI SDK format.
 * Supports standard OpenAI messages plus extended features:
 * - reasoning_content (DeepSeek-style thinking)
 * - reasoning_effort parameter
 */
export class OpenAIMessageConverter implements IMessageConverter<ExtendedChatCompletionCreateParams> {
  /**
   * Convert OpenAI ChatCompletionCreateParams to AI SDK ModelMessage[]
   */
  toAiSdkMessages(params: ExtendedChatCompletionCreateParams): ModelMessage[] {
    const messages: ModelMessage[] = []

    // Build tool call ID to name mapping for tool results
    const toolCallIdToName = new Map<string, string>()
    for (const msg of params.messages) {
      if (msg.role === 'assistant') {
        const assistantMsg = msg as ChatCompletionAssistantMessageParam
        if (assistantMsg.tool_calls) {
          for (const toolCall of assistantMsg.tool_calls) {
            // Only handle function tool calls
            if (toolCall.type === 'function') {
              toolCallIdToName.set(toolCall.id, toolCall.function.name)
            }
          }
        }
      }
    }

    for (const msg of params.messages) {
      const converted = this.convertMessage(msg, toolCallIdToName)
      if (converted) {
        messages.push(...converted)
      }
    }

    return messages
  }

  /**
   * Convert a single OpenAI message to AI SDK message(s)
   */
  private convertMessage(
    msg: ChatCompletionMessageParam,
    toolCallIdToName: Map<string, string>
  ): ModelMessage[] | null {
    switch (msg.role) {
      case 'system':
        return this.convertSystemMessage(msg)
      case 'user':
        return this.convertUserMessage(msg as ChatCompletionUserMessageParam)
      case 'assistant':
        return this.convertAssistantMessage(msg as ExtendedAssistantMessage)
      case 'tool':
        return this.convertToolMessage(msg as ChatCompletionToolMessageParam, toolCallIdToName)
      case 'function':
        // Legacy function messages - skip or handle as needed
        return null
      default:
        return null
    }
  }

  /**
   * Convert system message
   */
  private convertSystemMessage(msg: ChatCompletionMessageParam): ModelMessage[] {
    if (msg.role !== 'system') return []

    // Handle string content
    if (typeof msg.content === 'string') {
      return [{ role: 'system', content: msg.content }]
    }

    // Handle array content (system messages can have text parts)
    if (Array.isArray(msg.content)) {
      const textContent = msg.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      if (textContent) {
        return [{ role: 'system', content: textContent }]
      }
    }

    return []
  }

  /**
   * Convert user message
   */
  private convertUserMessage(msg: ChatCompletionUserMessageParam): ModelMessage[] {
    // Handle string content
    if (typeof msg.content === 'string') {
      return [{ role: 'user', content: msg.content }]
    }

    // Handle array content (text + images)
    if (Array.isArray(msg.content)) {
      const parts: (TextPart | ImagePart)[] = []

      for (const part of msg.content as ChatCompletionContentPart[]) {
        if (part.type === 'text') {
          parts.push({ type: 'text', text: part.text })
        } else if (part.type === 'image_url') {
          parts.push({ type: 'image', image: part.image_url.url })
        }
      }

      if (parts.length > 0) {
        return [{ role: 'user', content: parts }]
      }
    }

    return []
  }

  /**
   * Convert assistant message
   */
  private convertAssistantMessage(msg: ExtendedAssistantMessage): ModelMessage[] {
    const parts: (TextPart | ReasoningPart | ToolCallPart)[] = []

    // Handle reasoning_content (DeepSeek-style thinking)
    if (msg.reasoning_content) {
      parts.push({ type: 'reasoning', text: msg.reasoning_content })
    }

    // Handle text content
    if (msg.content) {
      if (typeof msg.content === 'string') {
        parts.push({ type: 'text', text: msg.content })
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            parts.push({ type: 'text', text: part.text })
          }
        }
      }
    }

    // Handle tool calls
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const toolCall of msg.tool_calls) {
        // Only handle function tool calls
        if (toolCall.type !== 'function') continue

        let input: unknown
        try {
          input = JSON.parse(toolCall.function.arguments)
        } catch {
          input = { raw: toolCall.function.arguments }
        }

        parts.push({
          type: 'tool-call',
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          input
        })
      }
    }

    if (parts.length > 0) {
      return [{ role: 'assistant', content: parts }]
    }

    return []
  }

  /**
   * Convert tool result message
   */
  private convertToolMessage(
    msg: ChatCompletionToolMessageParam,
    toolCallIdToName: Map<string, string>
  ): ModelMessage[] {
    const toolName = toolCallIdToName.get(msg.tool_call_id) || 'unknown'

    const toolResultPart: ToolResultPart = {
      type: 'tool-result',
      toolCallId: msg.tool_call_id,
      toolName,
      output: { type: 'text', value: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }
    }

    return [{ role: 'tool', content: [toolResultPart] }]
  }

  /**
   * Convert OpenAI tools to AI SDK tools
   */
  toAiSdkTools(params: ExtendedChatCompletionCreateParams): Record<string, AiSdkTool> | undefined {
    const tools = params.tools
    if (!tools || tools.length === 0) return undefined

    const aiSdkTools: Record<string, AiSdkTool> = {}

    for (const toolDef of tools) {
      if (toolDef.type !== 'function') continue

      const rawSchema = toolDef.function.parameters
      const schema = rawSchema ? jsonSchemaToZod(rawSchema as JsonSchemaLike) : jsonSchemaToZod({ type: 'object' })

      const aiTool = tool({
        description: toolDef.function.description || '',
        inputSchema: zodSchema(schema)
      })

      aiSdkTools[toolDef.function.name] = aiTool
    }

    return Object.keys(aiSdkTools).length > 0 ? aiSdkTools : undefined
  }

  /**
   * Extract stream/generation options from OpenAI params
   */
  extractStreamOptions(params: ExtendedChatCompletionCreateParams): StreamTextOptions {
    return {
      maxOutputTokens: params.max_tokens as number | undefined,
      temperature: params.temperature as number | undefined,
      topP: params.top_p as number | undefined,
      stopSequences: params.stop as string[] | undefined
    }
  }

  /**
   * Extract provider-specific options from OpenAI params
   * Maps reasoning_effort to provider-specific thinking/reasoning parameters
   */
  extractProviderOptions(provider: Provider, params: ExtendedChatCompletionCreateParams): ProviderOptions | undefined {
    return mapReasoningEffortToProviderOptions(provider, params.reasoning_effort)
  }
}

export default OpenAIMessageConverter
