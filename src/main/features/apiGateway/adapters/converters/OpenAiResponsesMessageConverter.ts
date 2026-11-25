/**
 * OpenAI Responses API Message Converter
 *
 * Converts OpenAI Responses API format to AI SDK format.
 * Uses types from @cherrystudio/openai SDK.
 */

import { UnsupportedFunctionalityError } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { DynamicToolUIPart, FileUIPart, ReasoningUIPart, TextUIPart, ToolSet } from 'ai'
import { jsonSchema, tool } from 'ai'
import mime from 'mime'

import type OpenAI from '@cherrystudio/openai'
import { loggerService } from '@logger'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { parseDataUrl } from '@shared/utils/dataUrl'

import type { IMessageConverter, StreamTextOptions } from '../interfaces'
import {
  mergeGatewayProviderOptions,
  nativeOpenAiOptions,
  openAiOutput,
  openAiToolChoice,
  parallelToolOptions
} from './openAiRequestOptions'
import type { ReasoningEffort } from './providerOptionsMapper'
import { mapReasoningEffortToProviderOptions } from './providerOptionsMapper'
import { isBlankToolName } from './toolName'

const logger = loggerService.withContext('OpenAiResponsesMessageConverter')

let uiMessageSeq = 0
function nextUIMessageId(): string {
  return `gateway-msg-${Date.now()}-${uiMessageSeq++}`
}

// SDK types
type ResponseCreateParams = OpenAI.Responses.ResponseCreateParams
type EasyInputMessage = OpenAI.Responses.EasyInputMessage
type FunctionCallOutput = OpenAI.Responses.ResponseInputItem.FunctionCallOutput

/** A function_call_output split into the model-visible string output and relocated user parts. */
interface FunctionOutputConversion {
  output: string
  relocatedParts: Array<TextUIPart | FileUIPart>
}

function inputFilePart(
  item: OpenAI.Responses.ResponseInputFile | OpenAI.Responses.ResponseInputFileContent
): FileUIPart {
  if (item.file_id || !(item.file_data || item.file_url)) {
    throw new UnsupportedFunctionalityError({
      functionality: 'Provider-bound Responses file_id; supply file_data or file_url'
    })
  }
  const dataUrlType = item.file_data ? parseDataUrl(item.file_data)?.mediaType : undefined
  const mediaType = dataUrlType ?? mime.getType(item.filename ?? item.file_url ?? '') ?? 'application/octet-stream'
  const url = item.file_url ?? (dataUrlType ? item.file_data! : `data:${mediaType};base64,${item.file_data}`)
  return { type: 'file', mediaType, url, ...(item.filename ? { filename: item.filename } : {}) }
}

function functionOutputAttachmentAnchor(callId: string, kind: string, index: number): string {
  return `[tool-result attachment call_id=${JSON.stringify(callId)} ${kind}=${index}]`
}

/**
 * Convert a function_call_output payload for the `dynamic-tool` UI part.
 *
 * Image/file items cannot ride inside the tool output: `convertToModelMessages`
 * only supports string/JSON tool outputs there, and OpenAI-style protocols have
 * no media tool content downstream — inlining base64 blows up the prompt
 * (#17078). Instead each media item becomes a `file` part relocated into a user
 * message right after the tool call, and the output keeps a placeholder
 * pointing at it. Provider-bound file IDs fail because they cannot be resolved
 * against an unrelated provider account.
 */
function functionOutputToConversion(callId: string, output: FunctionCallOutput['output']): FunctionOutputConversion {
  if (typeof output === 'string') return { output, relocatedParts: [] }
  const lines: string[] = []
  const relocatedParts: Array<TextUIPart | FileUIPart> = []
  let attachmentIndex = 0
  const attach = (kind: string, file: FileUIPart) => {
    const anchor = functionOutputAttachmentAnchor(callId, kind, ++attachmentIndex)
    const name = file.filename ? `, ${file.filename}` : ''
    lines.push(`${anchor} (${file.mediaType}${name}): attached in the following user message`)
    relocatedParts.push({ type: 'text', text: anchor }, file)
  }
  for (const item of output) {
    if (item.type === 'input_text') {
      lines.push(item.text)
    } else if (item.type === 'input_image' && item.image_url) {
      const mediaType = parseDataUrl(item.image_url)?.mediaType ?? 'image/*'
      attach('image', { type: 'file', mediaType, url: item.image_url })
    } else if (item.type === 'input_file') {
      attach('file', inputFilePart(item))
    } else {
      throw new UnsupportedFunctionalityError({ functionality: `Responses tool output: ${item.type}` })
    }
  }
  return { output: lines.join('\n'), relocatedParts }
}

/**
 * The reasoning chain a client echoed back. `content` (`reasoning_text`) is the raw chain and
 * wins; `summary` is the fallback. Encrypted-only items retain their metadata with empty text.
 */
function reasoningItemText(item: OpenAI.Responses.ResponseReasoningItem): string {
  const content = item.content?.map((part) => part.text).join('') ?? ''
  return content || (item.summary?.map((part) => part.text).join('') ?? '')
}

/**
 * Extended ResponseCreateParams with reasoning_effort
 */
export type ResponsesCreateParams = ResponseCreateParams & {
  reasoning_effort?: ReasoningEffort
  top_logprobs?: number
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
   * `reasoning` items become assistant reasoning parts — thinking-mode upstreams
   * require the chain back once a turn performed a tool call.
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
    const functionOutputs = new Map<string, FunctionOutputConversion>()
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
        functionOutputs.set(item.call_id, functionOutputToConversion(item.call_id, item.output))
      }
    }

    for (const item of inputArray) {
      // reasoning → assistant reasoning part. Emitted just ahead of the message or
      // function_call it belongs to, and `coalesceConsecutiveSameRole` merges the two.
      if ('type' in item && item.type === 'reasoning') {
        const text = reasoningItemText(item)
        if (text || item.id || item.encrypted_content) {
          const metadata = {
            itemId: item.id,
            ...(item.encrypted_content != null && { reasoningEncryptedContent: item.encrypted_content })
          }
          const part: ReasoningUIPart = {
            type: 'reasoning',
            text,
            providerMetadata: { openai: metadata, azure: metadata }
          }
          messages.push({ id: nextUIMessageId(), role: 'assistant', parts: [part] })
        }
        continue
      }
      // Input or replayed output message (role + content)
      if ('role' in item && 'content' in item) {
        const converted = this.convertMessage(item)
        if (converted) messages.push(converted)
        continue
      }
      // function_call → assistant dynamic-tool part (pair with output if present)
      if ('type' in item && item.type === 'function_call' && 'call_id' in item) {
        const funcCall = item
        const call = functionCalls.get(funcCall.call_id)
        if (!call) continue
        const result = functionOutputs.get(funcCall.call_id)
        const base = { type: 'dynamic-tool' as const, toolName: call.name, toolCallId: funcCall.call_id }
        const part: DynamicToolUIPart = result
          ? { ...base, state: 'output-available', input: call.input, output: result.output }
          : { ...base, state: 'input-available', input: call.input }
        messages.push({ id: nextUIMessageId(), role: 'assistant', parts: [part] })
        continue
      }
      // function_call_output: the string output is folded into its function_call
      // above; relocated tool-output media surface here as a user message.
      if ('type' in item && item.type === 'function_call_output') {
        const relocatedParts = functionOutputs.get(item.call_id)?.relocatedParts
        if (relocatedParts?.length) {
          messages.push({ id: nextUIMessageId(), role: 'user', parts: [...relocatedParts] })
        }
        continue
      }
      throw new UnsupportedFunctionalityError({ functionality: 'Responses non-function input item' })
    }

    return messages
  }

  /**
   * Convert an input or replayed output message to a UIMessage (or null to skip).
   */
  private convertMessage(msg: EasyInputMessage | OpenAI.Responses.ResponseOutputMessage): CherryUIMessage | null {
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
        if (img.file_id || !img.image_url) {
          throw new UnsupportedFunctionalityError({
            functionality: 'Provider-bound Responses image file_id; supply image_url'
          })
        }
        const mediaType = parseDataUrl(img.image_url)?.mediaType ?? 'image/*'
        const p: FileUIPart = {
          type: 'file',
          mediaType,
          url: img.image_url,
          providerMetadata: { openai: { imageDetail: img.detail } }
        }
        parts.push(p)
      } else if (part.type === 'input_file') {
        parts.push(inputFilePart(part))
      }
    }

    if (parts.length > 0) return { id: nextUIMessageId(), role: 'user', parts }
    return null
  }

  private convertAssistantMessage(
    content: EasyInputMessage['content'] | OpenAI.Responses.ResponseOutputMessage['content']
  ): CherryUIMessage | null {
    const parts: CherryUIMessage['parts'] = []

    if (typeof content === 'string') {
      parts.push({ type: 'text', text: content })
    } else {
      for (const part of content) {
        if (part.type === 'input_text' || part.type === 'output_text') parts.push({ type: 'text', text: part.text })
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
    const droppedTools: Array<{ index: number; path: string; name: string; description?: string | null }> = []

    for (const [index, toolDef] of tools.entries()) {
      if (toolDef.type !== 'function') {
        throw new UnsupportedFunctionalityError({ functionality: `Responses built-in tool: ${toolDef.type}` })
      }
      if (isBlankToolName(toolDef.name)) {
        droppedTools.push({
          index,
          path: `tools[${index}].name`,
          name: toolDef.name,
          description: toolDef.description
        })
        continue
      }

      const funcTool = toolDef
      const rawSchema = funcTool.parameters
      const schema = rawSchema ?? { type: 'object' as const }

      const aiTool = tool({
        description: funcTool.description || '',
        inputSchema: jsonSchema(schema),
        ...(typeof funcTool.strict === 'boolean' ? { strict: funcTool.strict } : {})
      })

      aiSdkTools[funcTool.name] = aiTool
    }

    if (droppedTools.length > 0) {
      logger.warn('Dropped tools with empty or whitespace-only names before provider request', {
        inputFormat: 'openai-responses',
        model: params.model,
        droppedTools
      })
    }

    return Object.keys(aiSdkTools).length > 0 ? aiSdkTools : undefined
  }

  /**
   * Extract stream/generation options from Responses API params
   */
  extractStreamOptions(params: ResponsesCreateParams): StreamTextOptions {
    if (params.previous_response_id || params.conversation || params.background || params.store === true) {
      throw new UnsupportedFunctionalityError({
        functionality: 'Stateful, stored or background Responses; replay full history with store:false'
      })
    }
    const unsupportedInclude = params.include?.filter(
      (item) => !['reasoning.encrypted_content', 'message.output_text.logprobs'].includes(item)
    )
    if (unsupportedInclude?.length) {
      throw new UnsupportedFunctionalityError({ functionality: `Responses include: ${unsupportedInclude.join(', ')}` })
    }
    return {
      maxOutputTokens: params.max_output_tokens ?? undefined,
      temperature: params.temperature ?? undefined,
      topP: params.top_p ?? undefined,
      toolChoice: openAiToolChoice(params.tool_choice),
      output: openAiOutput(params.text?.format)
    }
  }

  /**
   * Extract provider-specific options from Responses API params
   */
  extractProviderOptions(
    provider: Provider,
    model: Model,
    params: ResponsesCreateParams,
    maxOutputTokens?: number,
    overrideReasoning = false
  ): ProviderOptions | undefined {
    const reasoning = overrideReasoning
      ? undefined
      : mapReasoningEffortToProviderOptions(
          provider,
          model,
          params.reasoning?.effort ?? params.reasoning_effort,
          maxOutputTokens
        )
    const parallel = parallelToolOptions(provider, model, params.parallel_tool_calls)
    const wantsLogprobs = params.include?.includes('message.output_text.logprobs')
    const native = nativeOpenAiOptions(provider, model, {
      ...(params.service_tier != null && { serviceTier: params.service_tier }),
      ...(params.reasoning?.summary != null && { reasoningSummary: params.reasoning.summary }),
      ...(params.text?.verbosity != null && { textVerbosity: params.text.verbosity }),
      ...(params.truncation != null && { truncation: params.truncation }),
      ...(params.include?.length && { include: params.include }),
      ...(wantsLogprobs || params.top_logprobs ? { logprobs: params.top_logprobs || true } : {}),
      ...(params.text?.format?.type === 'json_schema' &&
        params.text.format.strict != null && { strictJsonSchema: params.text.format.strict })
    })
    return mergeGatewayProviderOptions(reasoning, parallel, native)
  }
}

export default OpenAiResponsesMessageConverter
