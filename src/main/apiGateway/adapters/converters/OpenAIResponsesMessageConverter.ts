/**
 * OpenAI Responses API Message Converter
 *
 * Converts OpenAI Responses API format to AI SDK format.
 * Uses types from @cherrystudio/openai SDK.
 */

import type { ProviderOptions, ToolCallPart, ToolResultPart } from '@ai-sdk/provider-utils'
import type OpenAI from '@cherrystudio/openai'
import type { Provider } from '@types'
import type { ImagePart, ModelMessage, TextPart, Tool as AiSdkTool } from 'ai'
import { tool, zodSchema } from 'ai'

import type { IMessageConverter, StreamTextOptions } from '../interfaces'
import { type JsonSchemaLike, jsonSchemaToZod } from './json-schema-to-zod'
import type { ReasoningEffort } from './provider-options-mapper'
import { mapReasoningEffortToProviderOptions } from './provider-options-mapper'

// SDK types
type ResponseCreateParams = OpenAI.Responses.ResponseCreateParams
type EasyInputMessage = OpenAI.Responses.EasyInputMessage
type FunctionTool = OpenAI.Responses.FunctionTool
type ResponseInputText = OpenAI.Responses.ResponseInputText
type ResponseInputImage = OpenAI.Responses.ResponseInputImage

/**
 * Extended ResponseCreateParams with reasoning_effort
 */
export type ResponsesCreateParams = ResponseCreateParams & {
  reasoning_effort?: ReasoningEffort
}

/**
 * OpenAI Responses Message Converter
 */
export class OpenAIResponsesMessageConverter implements IMessageConverter<ResponsesCreateParams> {
  /**
   * Convert Responses API params to AI SDK ModelMessage[]
   */
  toAiSdkMessages(params: ResponsesCreateParams): ModelMessage[] {
    const messages: ModelMessage[] = []

    // Add instructions as system message if present
    if (params.instructions && typeof params.instructions === 'string') {
      messages.push({ role: 'system', content: params.instructions })
    }

    // Handle no input
    if (!params.input) {
      return messages
    }

    // Handle string input
    if (typeof params.input === 'string') {
      messages.push({ role: 'user', content: params.input })
      return messages
    }

    // Handle message array input
    const inputArray = params.input

    // Build tool call ID to name mapping for tool results
    const toolCallIdToName = new Map<string, string>()
    for (const item of inputArray) {
      // Handle ResponseFunctionToolCall
      if ('type' in item && item.type === 'function_call' && 'call_id' in item && 'name' in item) {
        const funcCall = item as OpenAI.Responses.ResponseFunctionToolCall
        toolCallIdToName.set(funcCall.call_id, funcCall.name)
      }
    }

    for (const item of inputArray) {
      const converted = this.convertInputItem(item, toolCallIdToName)
      if (converted.length > 0) {
        messages.push(...converted)
      }
    }

    return messages
  }

  /**
   * Convert a single input item to AI SDK message(s)
   */
  private convertInputItem(
    item: OpenAI.Responses.ResponseInputItem,
    toolCallIdToName: Map<string, string>
  ): ModelMessage[] {
    // Handle EasyInputMessage (has role and content)
    if ('role' in item && 'content' in item) {
      return this.convertEasyInputMessage(item as EasyInputMessage)
    }

    // Handle function_call_output
    if ('type' in item && item.type === 'function_call_output') {
      const output = item as OpenAI.Responses.ResponseInputItem.FunctionCallOutput
      const outputStr = typeof output.output === 'string' ? output.output : JSON.stringify(output.output)
      return this.convertFunctionCallOutput(output.call_id, outputStr, toolCallIdToName)
    }

    return []
  }

  /**
   * Convert EasyInputMessage to AI SDK message
   */
  private convertEasyInputMessage(msg: EasyInputMessage): ModelMessage[] {
    switch (msg.role) {
      case 'developer':
      case 'system':
        return this.convertSystemMessage(msg.content)
      case 'user':
        return this.convertUserMessage(msg.content)
      case 'assistant':
        return this.convertAssistantMessage(msg.content)
      default:
        return []
    }
  }

  /**
   * Convert system message content
   */
  private convertSystemMessage(content: EasyInputMessage['content']): ModelMessage[] {
    if (typeof content === 'string') {
      return [{ role: 'system', content }]
    }

    // Array content - extract text from input_text parts
    const textParts: string[] = []
    for (const part of content) {
      if (part.type === 'input_text') {
        textParts.push((part as ResponseInputText).text)
      }
    }

    if (textParts.length > 0) {
      return [{ role: 'system', content: textParts.join('\n') }]
    }

    return []
  }

  /**
   * Convert user message content
   */
  private convertUserMessage(content: EasyInputMessage['content']): ModelMessage[] {
    if (typeof content === 'string') {
      return [{ role: 'user', content }]
    }

    const parts: (TextPart | ImagePart)[] = []

    for (const part of content) {
      if (part.type === 'input_text') {
        parts.push({ type: 'text', text: (part as ResponseInputText).text })
      } else if (part.type === 'input_image') {
        const img = part as ResponseInputImage
        if (img.image_url) {
          parts.push({ type: 'image', image: img.image_url })
        }
      }
    }

    if (parts.length > 0) {
      return [{ role: 'user', content: parts }]
    }

    return []
  }

  /**
   * Convert assistant message content
   */
  private convertAssistantMessage(content: EasyInputMessage['content']): ModelMessage[] {
    const parts: (TextPart | ToolCallPart)[] = []

    if (typeof content === 'string') {
      parts.push({ type: 'text', text: content })
    } else {
      for (const part of content) {
        // input_text can appear in assistant messages in conversation history
        if (part.type === 'input_text') {
          parts.push({ type: 'text', text: (part as ResponseInputText).text })
        }
      }
    }

    if (parts.length > 0) {
      return [{ role: 'assistant', content: parts }]
    }

    return []
  }

  /**
   * Convert function call output to tool result
   */
  private convertFunctionCallOutput(
    callId: string,
    output: string,
    toolCallIdToName: Map<string, string>
  ): ModelMessage[] {
    const toolName = toolCallIdToName.get(callId) || 'unknown'

    const toolResultPart: ToolResultPart = {
      type: 'tool-result',
      toolCallId: callId,
      toolName,
      output: { type: 'text', value: output }
    }

    return [{ role: 'tool', content: [toolResultPart] }]
  }

  /**
   * Convert Responses API tools to AI SDK tools
   */
  toAiSdkTools(params: ResponsesCreateParams): Record<string, AiSdkTool> | undefined {
    const tools = params.tools
    if (!tools || tools.length === 0) return undefined

    const aiSdkTools: Record<string, AiSdkTool> = {}

    for (const toolDef of tools) {
      if (toolDef.type !== 'function') continue

      const funcTool = toolDef as FunctionTool
      const rawSchema = funcTool.parameters
      const schema = rawSchema ? jsonSchemaToZod(rawSchema as JsonSchemaLike) : jsonSchemaToZod({ type: 'object' })

      const aiTool = tool({
        description: funcTool.description || '',
        inputSchema: zodSchema(schema)
      })

      aiSdkTools[funcTool.name] = aiTool
    }

    return Object.keys(aiSdkTools).length > 0 ? aiSdkTools : undefined
  }

  /**
   * Extract stream/generation options from Responses API params
   */
  extractStreamOptions(params: ResponsesCreateParams): StreamTextOptions {
    return {
      maxOutputTokens: params.max_output_tokens ?? undefined,
      temperature: params.temperature ?? undefined,
      topP: params.top_p ?? undefined
    }
  }

  /**
   * Extract provider-specific options from Responses API params
   */
  extractProviderOptions(provider: Provider, params: ResponsesCreateParams): ProviderOptions | undefined {
    return mapReasoningEffortToProviderOptions(provider, params.reasoning_effort)
  }
}

export default OpenAIResponsesMessageConverter
