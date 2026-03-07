export const MOONSHOT_WEB_SEARCH_TOOL_NAME = '$web_search'

export const MOONSHOT_WEB_SEARCH_TOOL_DEFINITION = {
  type: 'builtin_function',
  function: { name: MOONSHOT_WEB_SEARCH_TOOL_NAME }
} as const

/**
 * Adapts Moonshot builtin web search tool definition to provider SDK tool type.
 * This keeps unavoidable compatibility casts in a single shared place.
 */
export function asMoonshotBuiltinWebSearchTool<TTool>(): TTool {
  return MOONSHOT_WEB_SEARCH_TOOL_DEFINITION as unknown as TTool
}

type RecordLike = Record<string, unknown>

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null
}

export function isMoonshotBuiltinWebSearchTool(tool: unknown): boolean {
  if (!isRecord(tool)) {
    return false
  }

  const toolType = tool.type
  const toolFunction = isRecord(tool.function) ? tool.function : undefined
  const toolName = toolFunction?.name
  return toolType === 'builtin_function' && toolName === MOONSHOT_WEB_SEARCH_TOOL_NAME
}

/**
 * Normalizes Moonshot tool-call messages for built-in web search:
 * 1. assistant.tool_calls.$web_search.type => builtin_function
 * 2. tool message name backfilled from tool_call_id when missing.
 */
export function normalizeMoonshotBuiltinToolMessages(
  messages: unknown,
  builtinToolName: string = MOONSHOT_WEB_SEARCH_TOOL_NAME
): { messages: unknown[]; hasChanges: boolean } {
  if (!Array.isArray(messages)) {
    return { messages: [], hasChanges: false }
  }

  const toolCallNameById = new Map<string, string>()

  for (const message of messages) {
    if (!isRecord(message) || message.role !== 'assistant' || !Array.isArray(message.tool_calls)) {
      continue
    }

    for (const toolCall of message.tool_calls) {
      if (!isRecord(toolCall)) {
        continue
      }

      const toolId = typeof toolCall.id === 'string' ? toolCall.id : undefined
      const toolFunction = isRecord(toolCall.function) ? toolCall.function : undefined
      const toolName = typeof toolFunction?.name === 'string' ? toolFunction.name : undefined
      if (toolId && toolName) {
        toolCallNameById.set(toolId, toolName)
      }
    }
  }

  let hasChanges = false
  const normalizedMessages = messages.map((message) => {
    if (!isRecord(message)) {
      return message
    }

    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      let assistantChanged = false
      const normalizedToolCalls = message.tool_calls.map((toolCall) => {
        if (!isRecord(toolCall)) {
          return toolCall
        }

        const toolFunction = isRecord(toolCall.function) ? toolCall.function : undefined
        const toolName = typeof toolFunction?.name === 'string' ? toolFunction.name : undefined
        if (toolName === builtinToolName && toolCall.type !== 'builtin_function') {
          assistantChanged = true
          return {
            ...toolCall,
            type: 'builtin_function'
          }
        }

        return toolCall
      })

      if (assistantChanged) {
        hasChanges = true
        return {
          ...message,
          tool_calls: normalizedToolCalls
        }
      }
    }

    if (message.role === 'tool') {
      const toolCallId = typeof message.tool_call_id === 'string' ? message.tool_call_id : undefined
      const toolName = toolCallId ? toolCallNameById.get(toolCallId) : undefined
      if (toolName && typeof message.name !== 'string') {
        hasChanges = true
        return {
          ...message,
          name: toolName
        }
      }
    }

    return message
  })

  return { messages: normalizedMessages, hasChanges }
}
