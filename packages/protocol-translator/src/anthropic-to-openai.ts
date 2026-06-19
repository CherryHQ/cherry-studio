/**
 * Anthropic Messages API → OpenAI Chat Completions API translation.
 *
 * Converts Anthropic-format requests to OpenAI-compatible format, enabling
 * non-Anthropic models (GPT, Gemini via OpenAI-compatible endpoint) to serve
 * Agent requests that originate from the Anthropic SDK.
 */

import type {
  AnthropicContentBlock,
  AnthropicImageBlock,
  AnthropicMessage,
  AnthropicMessageParams,
  AnthropicTextBlock,
  AnthropicThinkingBlock,
  AnthropicTool,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
  OpenAIChatParams,
  OpenAIContentPart,
  OpenAIImageContent,
  OpenAIMessage,
  OpenAITextContent,
  OpenAITool,
  OpenAIToolCall,
  TranslationContext
} from './types'

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Convert an Anthropic Messages API request to an OpenAI Chat Completions
 * API request. Handles messages, system prompts, tools, and streaming params.
 */
export function anthropicToOpenAI(
  params: AnthropicMessageParams,
  context: TranslationContext
): OpenAIChatParams {
  const messages = convertMessages(params.messages, params.system, context)

  const result: OpenAIChatParams = {
    model: params.model,
    messages,
    max_tokens: params.max_tokens,
    temperature: params.temperature,
    top_p: params.top_p,
    stream: params.stream
  }

  if (params.stop_sequences?.length) {
    result.stop = params.stop_sequences
  }

  if (params.tools?.length) {
    result.tools = convertTools(params.tools)
    result.tool_choice = 'auto'
  }

  return result
}

// ── Message Conversion ─────────────────────────────────────────────────────

function convertMessages(
  messages: AnthropicMessage[],
  system?: string | AnthropicTextBlock[],
  context?: TranslationContext
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  // Anthropic system → OpenAI system message (must be first)
  if (system) {
    const systemContent = typeof system === 'string'
      ? system
      : system.map((b) => b.text).join('\n')
    result.push({ role: 'system', content: systemContent })
  }

  for (const msg of messages) {
    result.push(convertMessage(msg, context))
  }

  return result
}

function convertMessage(
  msg: AnthropicMessage,
  context?: TranslationContext
): OpenAIMessage {
  // Simple string content
  if (typeof msg.content === 'string') {
    return {
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }
  }

  // Content blocks → OpenAI parts + tool calls
  const parts: OpenAIContentPart[] = []
  const toolCalls: OpenAIToolCall[] = []

  for (const block of msg.content) {
    const converted = convertContentBlock(block, context)
    if (Array.isArray(converted)) {
      // tool_use blocks produce tool calls
      toolCalls.push(...converted)
    } else if (converted) {
      parts.push(converted)
    }
  }

  // If this is a tool_result message, format as OpenAI tool message
  if (msg.role === 'user' && hasOnlyToolResults(msg.content)) {
    return convertToolResultMessage(msg.content as AnthropicToolResultBlock[])
  }

  // Assistant message with tool calls
  if (msg.role === 'assistant' && toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: parts.length > 0 ? parts : null,
      tool_calls: toolCalls
    }
  }

  // Assistant message with text/thinking only
  if (msg.role === 'assistant') {
    // Merge thinking blocks into text (OpenAI doesn't have native thinking blocks)
    const text = parts
      .filter((p): p is OpenAITextContent => p.type === 'text')
      .map((p) => p.text)
      .join('')
    return { role: 'assistant', content: text || null }
  }

  // User message
  return {
    role: 'user',
    content: parts.length > 0 ? parts : null
  }
}

// ── Content Block Conversion ───────────────────────────────────────────────

function convertContentBlock(
  block: AnthropicContentBlock,
  context?: TranslationContext
): OpenAIContentPart | OpenAIToolCall[] | null {
  switch (block.type) {
    case 'text':
      return convertTextBlock(block)
    case 'image':
      return convertImageBlock(block)
    case 'tool_use':
      return convertToolUseBlock(block, context)
    case 'thinking':
      // Anthropic thinking → inline as text for OpenAI
      return convertThinkingBlock(block)
    case 'tool_result':
      // Handled separately at message level
      return null
    default:
      return null
  }
}

function convertTextBlock(block: AnthropicTextBlock): OpenAITextContent {
  return { type: 'text', text: block.text }
}

function convertImageBlock(block: AnthropicImageBlock): OpenAIImageContent {
  if (block.source.type === 'base64') {
    return {
      type: 'image_url',
      image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` }
    }
  }
  return {
    type: 'image_url',
    image_url: { url: block.source.url! }
  }
}

function convertThinkingBlock(block: AnthropicThinkingBlock): OpenAITextContent {
  // OpenAI doesn't have native thinking blocks; render as text
  return { type: 'text', text: `[thinking]\n${block.thinking}\n[/thinking]` }
}

function convertToolUseBlock(
  block: AnthropicToolUseBlock,
  context?: TranslationContext
): OpenAIToolCall[] {
  if (context) {
    context.toolUseMap.set(block.id, block.name)
  }
  return [{
    id: block.id,
    type: 'function',
    function: {
      name: block.name,
      arguments: JSON.stringify(block.input)
    }
  }]
}

// ── Tool Result Messages ───────────────────────────────────────────────────

function hasOnlyToolResults(content: AnthropicContentBlock[]): boolean {
  return content.length > 0 && content.every((b) => b.type === 'tool_result')
}

function convertToolResultMessage(blocks: AnthropicToolResultBlock[]): OpenAIMessage {
  // OpenAI expects one tool message per tool_use_id
  // For simplicity, merge all into one message if single, or return first
  if (blocks.length === 1) {
    const block = blocks[0]
    return {
      role: 'tool',
      tool_call_id: block.tool_use_id,
      content: typeof block.content === 'string'
        ? block.content
        : block.content.map((b) => ('text' in b ? (b as AnthropicTextBlock).text : '')).join('')
    }
  }

  // Multiple tool results: OpenAI format expects separate messages
  // This is handled by the caller splitting multi-result messages
  return {
    role: 'tool',
    tool_call_id: blocks[0].tool_use_id,
    content: JSON.stringify(
      blocks.map((b) => ({
        tool_use_id: b.tool_use_id,
        content: typeof b.content === 'string'
          ? b.content
          : (b.content as AnthropicTextBlock[]).map((t) => t.text).join('')
      }))
    )
  }
}

// ── Tool Definition Conversion ─────────────────────────────────────────────

/**
 * Convert Anthropic tool definitions to OpenAI function calling format.
 */
export function convertTools(tools: AnthropicTool[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema
    }
  }))
}

/**
 * Convert Anthropic tool definitions to OpenAI format, adapting
 * input_schema to OpenAI's expected parameters shape.
 */
export function convertAnthropicToolToOpenAI(tool: AnthropicTool): OpenAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: tool.input_schema.type,
        properties: tool.input_schema.properties ?? {},
        required: tool.input_schema.required ?? [],
        additionalProperties: false
      }
    }
  }
}

// ── Multi-Tool-Result Splitting ────────────────────────────────────────────

/**
 * Anthropic allows multiple tool_result blocks in a single user message.
 * OpenAI requires one tool message per tool call. Split into separate messages.
 */
export function splitToolResultMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  for (const msg of messages) {
    if (msg.role !== 'user' || typeof msg.content !== 'string') {
      result.push(msg)
      continue
    }

    // Try to detect merged tool results
    try {
      const parsed = JSON.parse(msg.content)
      if (Array.isArray(parsed) && parsed.every((r: unknown) =>
        typeof r === 'object' && r !== null && 'tool_use_id' in r
      )) {
        for (const item of parsed) {
          result.push({
            role: 'tool',
            tool_call_id: item.tool_use_id as string,
            content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content)
          })
        }
        continue
      }
    } catch {
      // Not JSON, keep as-is
    }

    result.push(msg)
  }

  return result
}
