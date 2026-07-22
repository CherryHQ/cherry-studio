/**
 * Convert an AI SDK prompt into the Perplexity Agent API `input[]` (plus the
 * system text hoisted to `instructions`). The Agent API is OpenAI-Responses
 * shaped, so we use Responses-style input content parts.
 *
 * ponytail: file parts follow OpenAI-Responses conventions (`input_image` /
 * `input_file`); if Perplexity diverges, adjust the two mappers below. Function
 * calls/results use the Agent API's Responses-style multi-turn input items.
 */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
  SharedV3Warning
} from '@ai-sdk/provider'
import { convertUint8ArrayToBase64 } from '@ai-sdk/provider-utils'

import type { PerplexityFunctionCallInput, PerplexityFunctionCallOutputInput } from './perplexityAgentSchemas'

type Prompt = LanguageModelV3CallOptions['prompt']

interface PerplexityAgentInputResult {
  input: Array<
    | { type: 'message'; role: string; content: string | unknown[] }
    | PerplexityFunctionCallInput
    | PerplexityFunctionCallOutputInput
  >
  instructions?: string
  warnings: SharedV3Warning[]
}

function fileToUrl(data: string | Uint8Array | URL, mediaType: string): string {
  if (data instanceof URL) return data.toString()
  if (typeof data === 'string') return data.startsWith('data:') ? data : `data:${mediaType};base64,${data}`
  return `data:${mediaType};base64,${convertUint8ArrayToBase64(data)}`
}

interface PerplexityToolMetadata {
  itemId?: string
  thoughtSignature?: string
}

function getToolMetadata(part: unknown): PerplexityToolMetadata | undefined {
  const value = part as {
    providerOptions?: { perplexity?: PerplexityToolMetadata }
    providerMetadata?: { perplexity?: PerplexityToolMetadata }
  }
  return value.providerOptions?.perplexity ?? value.providerMetadata?.perplexity
}

function serializeToolCallInput(input: unknown): string {
  return typeof input === 'string' ? input : (JSON.stringify(input ?? null) ?? 'null')
}

function serializeToolResultOutput(output: LanguageModelV3ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value
    case 'json':
    case 'error-json':
    case 'content':
      return JSON.stringify(output.value)
    case 'execution-denied':
      return output.reason ?? 'Tool execution denied.'
  }
}

export function convertToPerplexityAgentInput(prompt: Prompt): PerplexityAgentInputResult {
  const input: PerplexityAgentInputResult['input'] = []
  const warnings: SharedV3Warning[] = []
  const instructionParts: string[] = []
  const thoughtSignatures = new Map<string, string>()

  const mapToolResult = (part: LanguageModelV3ToolResultPart) => {
    const signature = getToolMetadata(part)?.thoughtSignature ?? thoughtSignatures.get(part.toolCallId)
    return {
      type: 'function_call_output' as const,
      call_id: part.toolCallId,
      name: part.toolName,
      output: serializeToolResultOutput(part.output),
      ...(signature ? { thought_signature: signature } : {})
    }
  }

  for (const { role, content } of prompt) {
    switch (role) {
      case 'system':
        instructionParts.push(content)
        break
      case 'user':
      case 'assistant': {
        const textType = role === 'assistant' ? 'output_text' : 'input_text'
        const parts: unknown[] = []
        const functionItems: Array<PerplexityFunctionCallInput | PerplexityFunctionCallOutputInput> = []
        for (const part of content) {
          switch (part.type) {
            case 'text':
              parts.push({ type: textType, text: part.text })
              break
            case 'file': {
              if (part.mediaType === 'application/pdf') {
                // Remote files go in `file_url`; `file_data` only accepts base64/data-URI.
                parts.push(
                  part.data instanceof URL
                    ? { type: 'input_file', file_url: part.data.toString() }
                    : {
                        type: 'input_file',
                        filename: part.filename ?? 'document.pdf',
                        file_data: fileToUrl(part.data, part.mediaType)
                      }
                )
              } else if (part.mediaType.startsWith('image/')) {
                parts.push({ type: 'input_image', image_url: fileToUrl(part.data, part.mediaType) })
              } else {
                warnings.push({ type: 'unsupported', feature: `file part (${part.mediaType})` })
              }
              break
            }
            case 'tool-call': {
              const signature = getToolMetadata(part)?.thoughtSignature
              if (signature) thoughtSignatures.set(part.toolCallId, signature)
              functionItems.push({
                type: 'function_call',
                call_id: part.toolCallId,
                name: part.toolName,
                arguments: serializeToolCallInput(part.input),
                ...(signature ? { thought_signature: signature } : {})
              })
              break
            }
            case 'tool-result': {
              const result = mapToolResult(part)
              if (result) functionItems.push(result)
              break
            }
            case 'reasoning':
              break
            default: {
              const _exhaustiveCheck: never = part
              warnings.push({ type: 'unsupported', feature: `assistant part ${String(_exhaustiveCheck)}` })
              break
            }
          }
        }
        if (parts.length > 0) {
          // Text-only turns collapse to a plain string, which the API also accepts.
          const textOnly = parts.every((part) => (part as { type: string }).type === textType)
          input.push({
            type: 'message',
            role,
            content: textOnly ? parts.map((part) => (part as { text: string }).text).join('') : parts
          })
        }
        input.push(...functionItems)
        break
      }
      case 'tool':
        for (const part of content) {
          if (part.type === 'tool-result') {
            const result = mapToolResult(part)
            if (result) input.push(result)
          } else {
            warnings.push({ type: 'unsupported', feature: 'tool approval response' })
          }
        }
        break
      default: {
        const _exhaustiveCheck: never = role
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`)
      }
    }
  }

  return {
    input,
    instructions: instructionParts.length > 0 ? instructionParts.join('\n\n') : undefined,
    warnings
  }
}
