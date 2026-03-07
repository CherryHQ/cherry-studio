import type { AiRequestContext } from '../../'

type ToolCallLike = {
  id?: unknown
  name?: unknown
  type?: unknown
  arguments?: unknown
  function?: {
    name?: unknown
    arguments?: unknown
  } | null
}

type ChunkLike = {
  toolCalls?: unknown
  tool_calls?: unknown
  finishReason?: unknown
  content?: unknown
}

type ParseToolArgumentsErrorHandler = (rawArguments: string, error: unknown) => void

export interface BuiltinToolCall {
  id: string
  name: string
  arguments: unknown
  rawArguments?: string
  toolType?: string
}

type AssistantToolCallMessage = {
  role: 'assistant'
  content: string
  tool_calls: Array<{
    id: string
    type: string
    function: {
      name: string
      arguments: string
    }
  }>
}

type ToolResultMessage = {
  tool_call_id: string
  role: 'tool'
  content: string
  name: string
}

type BuiltinLoopMessage = AssistantToolCallMessage | ToolResultMessage

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Built-in tool stream manager for provider-side tools such as Moonshot `$web_search`.
 */
export class BuiltinToolStreamManager {
  /**
   * Checks if the tool call targets a built-in provider tool.
   */
  isBuiltinToolCall(toolName: string, context: AiRequestContext): boolean {
    return context.builtinTools?.[toolName]?.isBuiltin ?? false
  }

  /**
   * Extracts normalized tool calls from either `toolCalls` or `tool_calls`.
   */
  extractToolCallsFromChunk(
    chunk: ChunkLike,
    options?: { onParseToolArgumentsError?: ParseToolArgumentsErrorHandler }
  ): BuiltinToolCall[] {
    const toolCalls = this.getToolCalls(chunk)
    if (toolCalls.length === 0) {
      return []
    }

    return toolCalls
      .map<BuiltinToolCall | null>((tc) => {
        const id = typeof tc.id === 'string' ? tc.id : undefined
        const functionName = typeof tc.function?.name === 'string' ? tc.function.name : undefined
        const name = functionName ?? (typeof tc.name === 'string' ? tc.name : undefined)
        if (!id || !name) {
          return null
        }

        const rawArguments = typeof tc.function?.arguments === 'string' ? tc.function.arguments : undefined
        let parsedArguments: unknown = tc.arguments ?? {}

        if (rawArguments) {
          try {
            parsedArguments = JSON.parse(rawArguments)
          } catch (error) {
            options?.onParseToolArgumentsError?.(rawArguments, error)
            parsedArguments = rawArguments
          }
        }

        return {
          id,
          name,
          arguments: parsedArguments,
          rawArguments,
          toolType: typeof tc.type === 'string' ? tc.type : undefined
        }
      })
      .filter((toolCall): toolCall is BuiltinToolCall => toolCall !== null)
  }

  /**
   * Handles finish-step chunks and creates synthetic tool messages for built-in tools.
   */
  async handleFinishStepWithBuiltinTools(
    chunk: ChunkLike,
    context: AiRequestContext
  ): Promise<{ shouldContinue: boolean; updatedMessages?: BuiltinLoopMessage[] }> {
    const { builtinTools } = context

    if (!builtinTools || Object.keys(builtinTools).length === 0) {
      return { shouldContinue: false }
    }

    if (chunk.finishReason !== 'tool_calls') {
      return { shouldContinue: false }
    }

    const toolCalls = this.extractToolCallsFromChunk(chunk, {
      onParseToolArgumentsError: (rawArguments, error) => {
        this.logDebug(context, 'Failed to parse builtin tool arguments as JSON; fallback to raw string', {
          error: error instanceof Error ? error.message : String(error),
          rawArgumentsPreview: rawArguments.slice(0, 256)
        })
      }
    })
    if (toolCalls.length === 0) {
      return { shouldContinue: false }
    }

    const builtinToolResults: ToolResultMessage[] = []
    let hasBuiltinTools = false

    for (const toolCall of toolCalls) {
      if (this.isBuiltinToolCall(toolCall.name, context)) {
        hasBuiltinTools = true
        builtinToolResults.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          name: toolCall.name,
          content: toolCall.rawArguments ?? JSON.stringify(toolCall.arguments ?? {})
        })
      }
    }

    if (hasBuiltinTools && builtinToolResults.length > 0) {
      const assistantMessage: AssistantToolCallMessage = {
        role: 'assistant',
        content: typeof chunk.content === 'string' ? chunk.content : '',
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          // Keep provider-emitted type first, then builtin registry metadata, then OpenAI default.
          type:
            tc.toolType ||
            context.builtinTools?.[tc.name]?.definition?.type ||
            context.builtinTools?.[tc.name]?.toolType ||
            'function',
          function: {
            name: tc.name,
            arguments: tc.rawArguments ?? JSON.stringify(tc.arguments ?? {})
          }
        }))
      }

      return {
        shouldContinue: true,
        updatedMessages: [assistantMessage, ...builtinToolResults]
      }
    }

    return { shouldContinue: false }
  }

  /**
   * Checks whether the chunk includes at least one built-in tool call.
   */
  hasBuiltinToolCalls(chunk: ChunkLike, context: AiRequestContext): boolean {
    const toolCalls = this.extractToolCallsFromChunk(chunk)
    if (toolCalls.length === 0) return false

    return toolCalls.some((tc) => this.isBuiltinToolCall(tc.name, context))
  }

  private getToolCalls(chunk: ChunkLike): ToolCallLike[] {
    const toolCalls = Array.isArray(chunk.toolCalls)
      ? chunk.toolCalls
      : Array.isArray(chunk.tool_calls)
        ? chunk.tool_calls
        : []
    return toolCalls.filter((toolCall): toolCall is ToolCallLike => isObjectLike(toolCall))
  }

  private logDebug(context: AiRequestContext, message: string, data?: Record<string, unknown>): void {
    const logger = context.logger
    if (typeof logger === 'function') {
      logger('debug', message, data)
    }
  }
}
