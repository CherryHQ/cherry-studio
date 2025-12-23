import * as z from 'zod'

import type { CdpBrowserController } from '../controller'
import { successResponse } from './utils'

export const ResetSchema = z.object({
  privateMode: z.boolean().optional().describe('true=private session, false=normal session, omit=all sessions'),
  tabId: z.string().optional().describe('Close specific tab only (requires privateMode)')
})

export const resetToolDefinition = {
  name: 'reset',
  description:
    'Close browser windows and clear session state. Call when done browsing to free resources. Omit all parameters to close everything.',
  inputSchema: {
    type: 'object',
    properties: {
      privateMode: {
        type: 'boolean',
        description: 'true=reset private session only, false=reset normal session only, omit=reset all'
      },
      tabId: {
        type: 'string',
        description: 'Close specific tab only (requires privateMode to be set)'
      }
    }
  }
}

export async function handleReset(controller: CdpBrowserController, args: unknown) {
  const { privateMode, tabId } = ResetSchema.parse(args)
  await controller.reset(privateMode, tabId)
  return successResponse('reset')
}
