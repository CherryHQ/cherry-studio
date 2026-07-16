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
import type { CherryUIMessage } from '@shared/data/types/message'
import type { Provider } from '@shared/data/types/provider'
import type { DynamicToolUIPart, FileUIPart, ReasoningUIPart, TextUIPart, ToolSet } from 'ai'
import { tool, zodSchema } from 'ai'

import type { IMessageConverter, StreamTextOptions } from '../interfaces'
import { type JsonSchemaLike, jsonSchemaToZod } from './jsonSchemaToZod'
import { mapGeminiThinkingToProviderOptions } from './providerOptionsMapper'

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

/** Multimodal payload of a function response (Gemini 3+) — one field set per part. */
interface GeminiFunctionResponsePart {
  inlineData?: GeminiBlob
  fileData?: GeminiFileData
}

interface GeminiFunctionResponse {
  id?: string
  name?: string
  response?: Record<string, unknown>
  parts?: GeminiFunctionResponsePart[]
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
  /** Gemini 3 reasoning level (`low` / `high`), an alternative to `thinkingBudget`. */
  thinkingLevel?: string
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

/** The multimodal `functionResponse.parts` (Gemini 3+) as `file` UI parts. */
function functionResponseMediaToFileParts(functionResponse: GeminiFunctionResponse): FileUIPart[] {
  const files: FileUIPart[] = []
  for (const part of functionResponse.parts ?? []) {
    if (part.inlineData?.data) {
      const mediaType = part.inlineData.mimeType || 'application/octet-stream'
      files.push({ type: 'file', mediaType, url: `data:${mediaType};base64,${part.inlineData.data}` })
    } else if (part.fileData?.fileUri) {
      files.push({
        type: 'file',
        mediaType: part.fileData.mimeType || 'application/octet-stream',
        url: part.fileData.fileUri
      })
    }
  }
  return files
}

/**
 * Flatten a Gemini `functionResponse` into the plain-string tool output.
 *
 * Multimodal `parts` cannot ride inside the tool output: `convertToModelMessages`
 * only supports string/JSON tool outputs there, and OpenAI-style protocols have
 * no media tool content downstream — inlining base64 blows up the prompt (#17078).
 * Instead each media part becomes a `file` part relocated into the user message
 * that carried the functionResponse, and the output keeps a placeholder.
 */
function functionResponseToOutput(functionResponse: GeminiFunctionResponse): string {
  const response = functionResponse.response
  const base = response === undefined ? '' : typeof response === 'string' ? response : JSON.stringify(response)
  const media = functionResponseMediaToFileParts(functionResponse)
  if (media.length === 0) return base
  const lines = media.map((file, i) => `[media ${i + 1} (${file.mediaType}): attached in the following user message]`)
  return [base, ...lines].filter(Boolean).join('\n')
}

/** Function responses grouped for pairing: by explicit id, and per-name FIFO queues for id-less payloads. */
interface CollectedToolResponses {
  byId: Map<string, string>
  queuesByName: Map<string, string[]>
}

/**
 * Resolve — and consume — the tool output for a Gemini `functionCall`. Prefers the
 * explicit id (unique per Gemini 3); for id-less payloads (Gemini 1.5/2.0/2.5)
 * falls back to a per-name FIFO queue so parallel same-name calls each take their
 * own response in document order instead of every one reading the last response.
 * Returns `undefined` when no matching response exists yet (call awaiting result).
 */
function takeToolOutput(call: GeminiFunctionCall, responses: CollectedToolResponses): string | undefined {
  if (call.id !== undefined) return responses.byId.get(call.id)
  if (call.name !== undefined) return responses.queuesByName.get(call.name)?.shift()
  return undefined
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
   * reconstructs the call/result pair coherently. Calls and responses are paired by
   * their explicit id when present (Gemini 3); id-less payloads (Gemini 1.5/2.0/2.5)
   * fall back to a per-name FIFO queue so parallel same-name calls stay paired 1:1.
   */
  toUIMessages(params: GeminiGenerateContentRequest): CherryUIMessage[] {
    const messages: CherryUIMessage[] = []

    const systemText = contentToText(params.systemInstruction)
    if (systemText) {
      messages.push({ id: nextUIMessageId(), role: 'system', parts: [{ type: 'text', text: systemText }] })
    }

    const contents = Array.isArray(params.contents) ? params.contents : []

    // Match function responses back to their calls. Responses with an explicit id
    // are keyed by it; id-less responses (older Gemini payloads) are queued per
    // name in document order so same-name parallel calls consume them FIFO instead
    // of colliding on a single name key (later response overwriting the earlier).
    const toolResponses: CollectedToolResponses = { byId: new Map(), queuesByName: new Map() }
    for (const content of contents) {
      if (!Array.isArray(content.parts)) continue
      for (const part of content.parts) {
        const functionResponse = part.functionResponse
        if (!functionResponse) continue
        const output = functionResponseToOutput(functionResponse)
        if (functionResponse.id !== undefined) {
          toolResponses.byId.set(functionResponse.id, output)
        } else if (functionResponse.name !== undefined) {
          const queue = toolResponses.queuesByName.get(functionResponse.name)
          if (queue) queue.push(output)
          else toolResponses.queuesByName.set(functionResponse.name, [output])
        }
      }
    }

    let toolCallSeq = 0
    for (const content of contents) {
      const role = content.role === 'model' ? 'assistant' : 'user'
      if (!Array.isArray(content.parts)) continue

      const parts: CherryUIMessage['parts'] = []
      for (const part of content.parts) {
        // Gemini 3 attaches an opaque `thoughtSignature` to the model's thought /
        // text / functionCall parts and requires it echoed back verbatim on the next
        // turn (missing it → HTTP 400). Carry it through AI SDK provider metadata so
        // the Google provider re-sends it (mirrors AnthropicMessageConverter).
        const signatureMetadata = part.thoughtSignature
          ? { google: { thoughtSignature: part.thoughtSignature } }
          : undefined
        if (typeof part.text === 'string' && part.text.length > 0) {
          if (part.thought) {
            const reasoning: ReasoningUIPart = { type: 'reasoning', text: part.text }
            if (signatureMetadata) reasoning.providerMetadata = signatureMetadata
            parts.push(reasoning)
          } else {
            const text: TextUIPart = { type: 'text', text: part.text }
            if (signatureMetadata) text.providerMetadata = signatureMetadata
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
          const output = takeToolOutput(part.functionCall, toolResponses)
          const base = {
            type: 'dynamic-tool' as const,
            toolName,
            toolCallId,
            ...(signatureMetadata ? { callProviderMetadata: signatureMetadata } : {})
          }
          const toolPart: DynamicToolUIPart =
            output !== undefined
              ? { ...base, state: 'output-available', input: part.functionCall.args ?? {}, output }
              : { ...base, state: 'input-available', input: part.functionCall.args ?? {} }
          parts.push(toolPart)
        } else if (part.functionResponse) {
          // The string output is absorbed into the matching functionCall part above;
          // relocated multimodal response parts surface here as user-message file parts.
          parts.push(...functionResponseMediaToFileParts(part.functionResponse))
        }
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
   * Delegated to the Gemini-native mapper so a Gemini/Google target keeps its sentinel
   * semantics (`-1` dynamic / `0` disabled / `> 0` fixed) and `thinkingLevel` intact
   * instead of being inverted by a round trip through the Anthropic thinking shape.
   */
  extractProviderOptions(provider: Provider, params: GeminiGenerateContentRequest): ProviderOptions | undefined {
    const thinkingConfig = params.generationConfig?.thinkingConfig
    if (!thinkingConfig) return undefined
    return mapGeminiThinkingToProviderOptions(provider, thinkingConfig)
  }
}

export default GeminiMessageConverter
