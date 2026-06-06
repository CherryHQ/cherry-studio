/**
 * OpenAI Responses API Message Converter
 *
 * Converts OpenAI Responses API format to AI SDK format.
 * Uses types from @cherrystudio/openai SDK.
 */

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type OpenAI from '@cherrystudio/openai'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { Provider } from '@shared/data/types/provider'
import { parseDataUrl } from '@shared/utils'
import type { DynamicToolUIPart, FileUIPart, TextUIPart, ToolSet } from 'ai'
import { tool, zodSchema } from 'ai'

import type { IMessageConverter, StreamTextOptions } from '../interfaces'
import { type JsonSchemaLike, jsonSchemaToZod } from './jsonSchemaToZod'
import type { ReasoningEffort } from './providerOptionsMapper'
import { mapReasoningEffortToProviderOptions } from './providerOptionsMapper'

let uiMessageSeq = 0
function nextUIMessageId(): string {
  return `gateway-msg-${Date.now()}-${uiMessageSeq++}`
}

// SDK types
type ResponseCreateParams = OpenAI.Responses.ResponseCreateParams
type EasyInputMessage = OpenAI.Responses.EasyInputMessage

/**
 * Extended ResponseCreateParams with reasoning_effort
 */
export type ResponsesCreateParams = ResponseCreateParams & {
  reasoning_effort?: ReasoningEffort
}

/**
 * OpenAI Responses Message Converter
 */
export class OpenAiResponsesMessageConverter implements IMessageConverter<ResponsesCreateParams> {
  /**
   * Convert Responses API params to AI SDK `CherryUIMessage[]`.
   *
   * `instructions` become a leading system UIMessage. `function_call` +
   * `function_call_output` items are paired into a single assistant
   * `dynamic-tool` part so `convertToModelMessages` rebuilds the call/result.
   */
  toUIMessages(params: ResponsesCreateParams): CherryUIMessage[] {
    const messages: CherryUIMessage[] = []

    if (params.instructions && typeof params.instructions === 'string') {
      messages.push({ id: nextUIMessageId(), role: 'system', parts: [{ type: 'text', text: params.instructions }] })
    }

    if (!params.input) return messages

    if (typeof params.input === 'string') {
      messages.push({ id: nextUIMessageId(), role: 'user', parts: [{ type: 'text', text: params.input }] })
      return messages
    }

    const inputArray = params.input

    // function_call items (callId → name + raw arguments) and their outputs.
    const functionCalls = new Map<string, { name: string; input: unknown }>()
    const functionOutputs = new Map<string, string>()
    for (const item of inputArray) {
      if ('type' in item && item.type === 'function_call' && 'call_id' in item && 'name' in item) {
        const funcCall = item
        let input: unknown
        try {
          input = funcCall.arguments ? JSON.parse(funcCall.arguments) : {}
        } catch {
          input = { raw: funcCall.arguments }
        }
        functionCalls.set(funcCall.call_id, { name: funcCall.name, input })
      } else if ('type' in item && item.type === 'function_call_output') {
        const output = item
        functionOutputs.set(
          output.call_id,
          typeof output.output === 'string' ? output.output : JSON.stringify(output.output)
        )
      }
    }

    for (const item of inputArray) {
      // EasyInputMessage (role + content)
      if ('role' in item && 'content' in item) {
        const converted = this.convertEasyInputMessage(item as EasyInputMessage)
        if (converted) messages.push(converted)
        continue
      }
      // function_call → assistant dynamic-tool part (pair with output if present)
      if ('type' in item && item.type === 'function_call' && 'call_id' in item) {
        const funcCall = item
        const call = functionCalls.get(funcCall.call_id)
        if (!call) continue
        const hasResult = functionOutputs.has(funcCall.call_id)
        const base = { type: 'dynamic-tool' as const, toolName: call.name, toolCallId: funcCall.call_id }
        const part: DynamicToolUIPart = hasResult
          ? { ...base, state: 'output-available', input: call.input, output: functionOutputs.get(funcCall.call_id) }
          : { ...base, state: 'input-available', input: call.input }
        messages.push({ id: nextUIMessageId(), role: 'assistant', parts: [part] })
      }
      // function_call_output is folded into its function_call above.
    }

    return messages
  }

  /**
   * Convert EasyInputMessage to a UIMessage (or null to skip).
   */
  private convertEasyInputMessage(msg: EasyInputMessage): CherryUIMessage | null {
    switch (msg.role) {
      case 'developer':
      case 'system':
        return this.convertSystemMessage(msg.content)
      case 'user':
        return this.convertUserMessage(msg.content)
      case 'assistant':
        return this.convertAssistantMessage(msg.content)
      default:
        return null
    }
  }

  private convertSystemMessage(content: EasyInputMessage['content']): CherryUIMessage | null {
    let text = ''
    if (typeof content === 'string') {
      text = content
    } else {
      text = content
        .filter((part) => part.type === 'input_text')
        .map((part) => part.text)
        .join('\n')
    }
    if (!text) return null
    return { id: nextUIMessageId(), role: 'system', parts: [{ type: 'text', text }] }
  }

  private convertUserMessage(content: EasyInputMessage['content']): CherryUIMessage | null {
    if (typeof content === 'string') {
      if (!content) return null
      return { id: nextUIMessageId(), role: 'user', parts: [{ type: 'text', text: content }] }
    }

    const parts: CherryUIMessage['parts'] = []
    for (const part of content) {
      if (part.type === 'input_text') {
        const p: TextUIPart = { type: 'text', text: part.text }
        parts.push(p)
      } else if (part.type === 'input_image') {
        const img = part
        if (img.image_url) {
          const mediaType = parseDataUrl(img.image_url)?.mediaType ?? 'image/*'
          const p: FileUIPart = { type: 'file', mediaType, url: img.image_url }
          parts.push(p)
        }
      }
    }

    if (parts.length > 0) return { id: nextUIMessageId(), role: 'user', parts }
    return null
  }

  private convertAssistantMessage(content: EasyInputMessage['content']): CherryUIMessage | null {
    const parts: CherryUIMessage['parts'] = []

    if (typeof content === 'string') {
      parts.push({ type: 'text', text: content })
    } else {
      for (const part of content) {
        if (part.type === 'input_text') parts.push({ type: 'text', text: part.text })
      }
    }

    if (parts.length > 0) return { id: nextUIMessageId(), role: 'assistant', parts }
    return null
  }

  /**
   * Convert Responses API tools to an AI SDK `ToolSet` (client tools, no `execute`).
   */
  toAiSdkTools(params: ResponsesCreateParams): ToolSet | undefined {
    const tools = params.tools
    if (!tools || tools.length === 0) return undefined

    const aiSdkTools: ToolSet = {}

    for (const toolDef of tools) {
      if (toolDef.type !== 'function') continue

      const funcTool = toolDef
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

export default OpenAiResponsesMessageConverter
