import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { successResponse } from './utils'

/** Zod schema for validating reset tool arguments */
export const ResetSchema = z.object({
  sessionId: z.string().optional().describe('Session identifier to reset; omit to reset all sessions')
})

/** MCP tool definition for the reset tool */
export const resetToolDefinition = {
  name: 'reset',
  description: 'Reset the controlled window and detach debugger',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session identifier to reset; omit to reset all sessions'
      }
    }
  }
}

/**
 * Handler for the reset MCP tool.
 * Closes browser window(s) and detaches debugger for the specified session or all sessions.
 */
export async function handleReset(controller: CdpBrowserController, args: unknown) {
  const { sessionId } = ResetSchema.parse(args)
  await controller.reset(sessionId)
  return successResponse('reset')
}
