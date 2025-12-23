import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { successResponse } from './utils'

export const ResetSchema = z.object({
  privateMode: z
    .boolean()
    .optional()
    .describe('If true, reset private session; if false, reset normal session; omit to reset all sessions'),
  tabId: z.string().optional().describe('Tab identifier to reset; requires privateMode to be specified')
})

export const resetToolDefinition = {
  name: 'reset',
  description: 'Reset the controlled window and detach debugger',
  inputSchema: {
    type: 'object',
    properties: {
      privateMode: {
        type: 'boolean',
        description: 'If true, reset private session; if false, reset normal session; omit to reset all sessions'
      },
      tabId: {
        type: 'string',
        description: 'Tab identifier to reset; requires privateMode to be specified'
      }
    }
  }
}

export async function handleReset(controller: CdpBrowserController, args: unknown) {
  const { privateMode, tabId } = ResetSchema.parse(args)
  await controller.reset(privateMode, tabId)
  return successResponse('reset')
}
