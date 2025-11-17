import { loggerService } from '@logger'
import type { LanguageModelMiddleware } from 'ai'

const logger = loggerService.withContext('toolChoiceMiddleware')

/**
 * Tool Choice Middleware
 * Controls tool selection strategy across multiple rounds of tool calls:
 * - First round: Forces the model to call a specific tool (e.g., knowledge base search)
 * - Subsequent rounds: Allows the model to automatically choose any available tool
 *
 * This ensures knowledge base is consulted first while still enabling MCP tools
 * and other capabilities in follow-up interactions.
 *
 * @param forceFirstToolName - The tool name to force on the first round
 * @returns LanguageModelMiddleware
 */
export function toolChoiceMiddleware(forceFirstToolName: string): LanguageModelMiddleware {
  let toolCallRound = 0

  return {
    middlewareVersion: 'v2',

    transformParams: async ({ params }) => {
      toolCallRound++

      const transformedParams = { ...params }

      if (toolCallRound === 1) {
        // First round: force the specified tool
        logger.debug(`Round ${toolCallRound}: Forcing tool choice to '${forceFirstToolName}'`)
        transformedParams.toolChoice = {
          type: 'tool',
          toolName: forceFirstToolName
        }
      } else {
        // Subsequent rounds: allow automatic tool selection
        logger.debug(`Round ${toolCallRound}: Using automatic tool choice`)
        transformedParams.toolChoice = { type: 'auto' }
      }

      return transformedParams
    }
  }
}
