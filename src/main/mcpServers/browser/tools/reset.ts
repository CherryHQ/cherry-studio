import type { CdpBrowserController } from '../controller'
import { successResponse } from './utils'

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

export async function handleReset(controller: CdpBrowserController, args: unknown) {
  const { sessionId } = args as { sessionId?: string }
  await controller.reset(sessionId)
  return successResponse('reset')
}
