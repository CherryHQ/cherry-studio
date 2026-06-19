/**
 * Anthropic Messages API ↔ Google Gemini GenerateContent API translation.
 *
 * Handles format conversion between these two major AI API protocols.
 */

import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicMessageParams,
  AnthropicTextBlock,
  AnthropicTool,
  GeminiContent,
  GeminiFunctionDeclaration,
  GeminiGenerateParams,
  GeminiPart,
  GeminiTextPart,
  GeminiTool,
  TranslationContext
} from './types'

// ── Anthropic → Gemini (Request) ───────────────────────────────────────────

/**
 * Convert an Anthropic Messages API request to a Gemini GenerateContent request.
 */
export function anthropicToGemini(
  params: AnthropicMessageParams,
  context: TranslationContext
): GeminiGenerateParams {
  const contents = convertMessagesToGemini(params.messages)

  const result: GeminiGenerateParams = {
    model: params.model,
    contents,
    generationConfig: {
      maxOutputTokens: params.max_tokens,
      temperature: params.temperature,
      topP: params.top_p ?? undefined as unknown as number,
      topK: params.top_k ?? undefined as unknown as number
    }
  }

  // Clean undefined values from generationConfig
  const config = result.generationConfig!
  if (config.topP === undefined) delete config.topP
  if (config.topK === undefined) delete config.topK
  if (config.temperature === undefined) delete config.temperature

  // System prompt → Gemini systemInstruction
  if (params.system) {
    const systemText = typeof params.system === 'string'
      ? params.system
      : params.system.map((b) => b.text).join('\n')
    result.systemInstruction = { text: systemText }
  }

  // Tools → Gemini function declarations
  if (params.tools?.length) {
    result.tools = [convertAnthropicToolsToGemini(params.tools)]
  }

  return result
}

function convertMessagesToGemini(messages: AnthropicMessage[]): GeminiContent[] {
  return messages.map((msg) => {
    const role: GeminiContent['role'] = msg.role === 'assistant' ? 'model' : 'user'
    const parts = convertContentBlocksToGeminiParts(msg.content)
    return { role, parts }
  })
}

function convertContentBlocksToGeminiParts(
  content: string | AnthropicContentBlock[]
): GeminiPart[] {
  if (typeof content === 'string') {
    return [{ text: content }]
  }

  const parts: GeminiPart[] = []

  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push({ text: block.text })
        break
      case 'tool_use':
        parts.push({
          functionCall: {
            name: block.name,
            args: block.input
          }
        })
        break
      case 'tool_result':
        parts.push({
          functionResponse: {
            name: '', // Gemini expects name but Anthropic tool_result doesn't carry it
            response: typeof block.content === 'string'
              ? { result: block.content }
              : { result: (block.content as AnthropicTextBlock[]).map((b) => b.text).join('') }
          }
        })
        break
      case 'image':
        if (block.source.type === 'base64') {
          parts.push({
            inlineData: {
              mimeType: block.source.media_type,
              data: block.source.data!
            }
          })
        } else {
          parts.push({
            fileData: {
              mimeType: block.source.media_type,
              fileUri: block.source.url!
            }
          })
        }
        break
      // thinking blocks don't have a direct Gemini equivalent; skip
    }
  }

  return parts
}

function convertAnthropicToolsToGemini(tools: AnthropicTool[]): GeminiTool {
  return {
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: tool.input_schema.type,
        properties: tool.input_schema.properties ?? {},
        required: tool.input_schema.required ?? []
      }
    }))
  }
}

// ── Gemini → Anthropic (Response) ─────────────────────────────────────────

/**
 * Convert a Gemini content response to Anthropic content blocks.
 */
export function geminiContentToAnthropicBlocks(
  parts: GeminiPart[],
  context?: TranslationContext
): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = []

  for (const part of parts) {
    if ('text' in part) {
      blocks.push({ type: 'text', text: part.text } as AnthropicTextBlock)
    } else if ('functionCall' in part) {
      const name = part.functionCall.name
      const id = `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      if (context) {
        context.toolUseMap.set(id, name)
      }
      blocks.push({
        type: 'tool_use',
        id,
        name,
        input: part.functionCall.args
      })
    }
    // inlineData / fileData → skip for now
  }

  return blocks
}

// ── Gemini Function Declaration → Anthropic Tool ───────────────────────────

/**
 * Convert Gemini function declarations to Anthropic tool definitions.
 */
export function geminiToolsToAnthropic(tools: GeminiTool[]): AnthropicTool[] {
  const result: AnthropicTool[] = []

  for (const tool of tools) {
    for (const decl of tool.functionDeclarations) {
      result.push({
        name: decl.name,
        description: decl.description,
        input_schema: {
          type: decl.parameters?.type ?? 'object',
          properties: decl.parameters?.properties ?? {},
          required: decl.parameters?.required ?? []
        }
      })
    }
  }

  return result
}
