/**
 * Gemini Message Converter
 *
 * Converts Google Generative Language (`generateContent`) request bodies to AI
 * SDK format. Handles `contents` (text / inline data / file data / function
 * calls + responses), `systemInstruction`, `tools.functionDeclarations`, and
 * `generationConfig` (sampling + thinking).
 *
 * Wire types are declared locally (matching the camelCase Gemini REST shape)
 * rather than imported from `@google/genai`, mirroring the other converters:
 * the payload is loosely validated at the route and parsed defensively here.
 */

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { Provider } from '@shared/data/types/provider'
import type { DynamicToolUIPart, FileUIPart, ReasoningUIPart, TextUIPart, ToolSet } from 'ai'
import { tool, zodSchema } from 'ai'

import type { IMessageConverter, StreamTextOptions } from '../interfaces'
import { type JsonSchemaLike, jsonSchemaToZod } from './jsonSchemaToZod'
import { mapAnthropicThinkingToProviderOptions } from './providerOptionsMapper'

/** Inline binary payload (`inlineData`). */
interface GeminiBlob {
  mimeType?: string
  data?: string
}

/** URI-referenced file payload (`fileData`). */
interface GeminiFileData {
  mimeType?: string
  fileUri?: string
}

interface GeminiFunctionCall {
  id?: string
  name?: string
  args?: Record<string, unknown>
}

interface GeminiFunctionResponse {
  id?: string
  name?: string
  response?: Record<string, unknown>
}

/** A single content part — exactly one payload field is set per Gemini's spec. */
interface GeminiPart {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  inlineData?: GeminiBlob
  fileData?: GeminiFileData
  functionCall?: GeminiFunctionCall
  functionResponse?: GeminiFunctionResponse
}

interface GeminiContent {
  role?: string
  parts?: GeminiPart[]
}

interface GeminiFunctionDeclaration {
  name?: string
  description?: string
  /** Gemini `Schema` (OpenAPI subset, UPPERCASE `type`). */
  parameters?: unknown
  /** Standard JSON Schema (preferred when present). */
  parametersJsonSchema?: unknown
}

interface GeminiTool {
  functionDeclarations?: GeminiFunctionDeclaration[]
}

interface GeminiThinkingConfig {
  includeThoughts?: boolean
  thinkingBudget?: number
}

interface GeminiGenerationConfig {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  stopSequences?: string[]
  thinkingConfig?: GeminiThinkingConfig
}

/** `POST /v1beta/models/{model}:generateContent` request body. */
export interface GeminiGenerateContentRequest {
  contents?: GeminiContent[]
  systemInstruction?: GeminiContent | string
  tools?: GeminiTool[]
  generationConfig?: GeminiGenerationConfig
}

let uiMessageSeq = 0
function nextUIMessageId(): string {
  return `gateway-msg-${Date.now()}-${uiMessageSeq++}`
}

/** Extract the concatenated text of a `Content`/string (used for `systemInstruction`). */
function contentToText(content: GeminiContent | string | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content.parts)) return ''
  return content.parts
    .filter((part) => typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
}

/** Flatten a Gemini `functionResponse.response` into the plain-string tool output. */
function functionResponseToOutput(response: GeminiFunctionResponse['response']): string {
  if (response === undefined) return ''
  if (typeof response === 'string') return response
  return JSON.stringify(response)
}

/**
 * Recursively lower-case a Gemini `Schema`'s UPPERCASE `type` enums (`STRING`,
 * `OBJECT`, …) into the JSON Schema vocabulary `jsonSchemaToZod` expects. Modern
 * clients send `parametersJsonSchema` (already JSON Schema) and skip this.
 */
function geminiSchemaToJsonSchema(schema: unknown): JsonSchemaLike {
  if (!schema || typeof schema !== 'object') return {}
  const source = schema as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key === 'type' && typeof value === 'string') {
      const lowered = value.toLowerCase()
      if (lowered !== 'type_unspecified') result.type = lowered
    } else if (key === 'properties' && value && typeof value === 'object') {
      const properties: Record<string, unknown> = {}
      for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
        properties[propName] = geminiSchemaToJsonSchema(propSchema)
      }
      result.properties = properties
    } else if (key === 'items') {
      result.items = geminiSchemaToJsonSchema(value)
    } else {
      result[key] = value
    }
  }
  return result as JsonSchemaLike
}

/**
 * Gemini Message Converter
 *
 * Converts a Gemini `GenerateContentRequest` to AI SDK `CherryUIMessage[]` +
 * `ToolSet` for the gateway's unified `AiStreamManager` pipeline.
 */
export class GeminiMessageConverter implements IMessageConverter<GeminiGenerateContentRequest> {
  /**
   * Convert Gemini `contents` (+ `systemInstruction`) to `CherryUIMessage[]`.
   *
   * `systemInstruction` becomes a leading `role: 'system'` message.
   * `functionResponse` parts are folded into the matching assistant
   * `functionCall`'s `dynamic-tool` part so `convertToModelMessages`
   * reconstructs the call/result pair coherently. Gemini function calls carry no
   * stable id in the older wire shape, so calls and responses are matched by name.
   */
  toUIMessages(params: GeminiGenerateContentRequest): CherryUIMessage[] {
    const messages: CherryUIMessage[] = []

    const systemText = contentToText(params.systemInstruction)
    if (systemText) {
      messages.push({ id: nextUIMessageId(), role: 'system', parts: [{ type: 'text', text: systemText }] })
    }

    const contents = Array.isArray(params.contents) ? params.contents : []

    // Match function responses back to their calls. Prefer the explicit id;
    // fall back to the function name (older Gemini payloads omit ids).
    const toolResultOutputs = new Map<string, string>()
    for (const content of contents) {
      if (!Array.isArray(content.parts)) continue
      for (const part of content.parts) {
        if (part.functionResponse) {
          const key = part.functionResponse.id ?? part.functionResponse.name
          if (key) toolResultOutputs.set(key, functionResponseToOutput(part.functionResponse.response))
        }
      }
    }

    let toolCallSeq = 0
    for (const content of contents) {
      const role = content.role === 'model' ? 'assistant' : 'user'
      if (!Array.isArray(content.parts)) continue

      const parts: CherryUIMessage['parts'] = []
      for (const part of content.parts) {
        if (typeof part.text === 'string' && part.text.length > 0) {
          if (part.thought) {
            const reasoning: ReasoningUIPart = { type: 'reasoning', text: part.text }
            parts.push(reasoning)
          } else {
            const text: TextUIPart = { type: 'text', text: part.text }
            parts.push(text)
          }
        } else if (part.inlineData?.data) {
          const mediaType = part.inlineData.mimeType || 'application/octet-stream'
          const file: FileUIPart = {
            type: 'file',
            mediaType,
            url: `data:${mediaType};base64,${part.inlineData.data}`
          }
          parts.push(file)
        } else if (part.fileData?.fileUri) {
          const file: FileUIPart = {
            type: 'file',
            mediaType: part.fileData.mimeType || 'application/octet-stream',
            url: part.fileData.fileUri
          }
          parts.push(file)
        } else if (part.functionCall) {
          const toolName = part.functionCall.name ?? 'unknown'
          const toolCallId = part.functionCall.id ?? `${toolName}-${toolCallSeq++}`
          const resultKey = part.functionCall.id ?? part.functionCall.name
          const hasResult = resultKey !== undefined && toolResultOutputs.has(resultKey)
          const base = { type: 'dynamic-tool' as const, toolName, toolCallId }
          const toolPart: DynamicToolUIPart = hasResult
            ? {
                ...base,
                state: 'output-available',
                input: part.functionCall.args ?? {},
                output: toolResultOutputs.get(resultKey)
              }
            : { ...base, state: 'input-available', input: part.functionCall.args ?? {} }
          parts.push(toolPart)
        }
        // functionResponse parts are absorbed into the matching functionCall part above.
      }

      if (parts.length > 0) {
        messages.push({ id: nextUIMessageId(), role, parts })
      }
    }

    return messages
  }

  /**
   * Convert Gemini `tools[].functionDeclarations` to an AI SDK `ToolSet` (client
   * tools, no `execute`). Built-in Gemini tools (googleSearch, codeExecution, …)
   * carry no `functionDeclarations` and are skipped.
   */
  toAiSdkTools(params: GeminiGenerateContentRequest): ToolSet | undefined {
    const tools = params.tools
    if (!Array.isArray(tools) || tools.length === 0) return undefined

    const aiSdkTools: ToolSet = {}
    for (const geminiTool of tools) {
      const declarations = geminiTool.functionDeclarations
      if (!Array.isArray(declarations)) continue
      for (const declaration of declarations) {
        if (!declaration.name) continue
        const rawSchema =
          declaration.parametersJsonSchema !== undefined
            ? (declaration.parametersJsonSchema as JsonSchemaLike)
            : geminiSchemaToJsonSchema(declaration.parameters)
        aiSdkTools[declaration.name] = tool({
          description: declaration.description || '',
          inputSchema: zodSchema(jsonSchemaToZod(rawSchema))
        })
      }
    }
    return Object.keys(aiSdkTools).length > 0 ? aiSdkTools : undefined
  }

  /** Extract sampling options from `generationConfig`. */
  extractStreamOptions(params: GeminiGenerateContentRequest): StreamTextOptions {
    const config = params.generationConfig ?? {}
    return {
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      stopSequences: config.stopSequences
    }
  }

  /**
   * Map `generationConfig.thinkingConfig` to provider-specific reasoning options.
   * Translated to the Anthropic-style thinking shape and delegated to the shared
   * mapper so every provider is handled identically to the other dialects.
   */
  extractProviderOptions(provider: Provider, params: GeminiGenerateContentRequest): ProviderOptions | undefined {
    const thinkingConfig = params.generationConfig?.thinkingConfig
    if (!thinkingConfig) return undefined

    const budget = thinkingConfig.thinkingBudget
    const enabled = thinkingConfig.includeThoughts === true || (typeof budget === 'number' && budget !== 0)
    const thinking: MessageCreateParams['thinking'] = enabled
      ? { type: 'enabled', budget_tokens: typeof budget === 'number' && budget > 0 ? budget : 0 }
      : { type: 'disabled' }
    return mapAnthropicThinkingToProviderOptions(provider, thinking)
  }
}

export default GeminiMessageConverter
