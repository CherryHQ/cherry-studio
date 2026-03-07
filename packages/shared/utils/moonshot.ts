export const MOONSHOT_PROVIDER_ID = 'moonshot'
export const MOONSHOT_WEB_SEARCH_TOOL_NAME = '$web_search'
export const MOONSHOT_DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1'

type ProviderLike = {
  id?: unknown
  apiHost?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Returns true when provider id or api host indicates Moonshot.
 */
export function isMoonshotProviderLike(
  provider: ProviderLike,
  moonshotProviderId: string = MOONSHOT_PROVIDER_ID
): boolean {
  if (provider.id === moonshotProviderId) {
    return true
  }

  if (typeof provider.apiHost !== 'string' || provider.apiHost.length === 0) {
    return false
  }

  try {
    const hostname = new URL(provider.apiHost).hostname
    return hostname === 'moonshot.cn' || hostname.endsWith('.moonshot.cn')
  } catch {
    return provider.apiHost.includes('moonshot.cn')
  }
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
